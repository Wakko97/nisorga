#!/usr/bin/env bash
#
# nisorga-healthcheck.sh
#
# Checks the Docker-native HEALTHCHECK status (already built into the
# postgres/backend/frontend images) of a Nisorga Docker Compose install,
# optionally restarts an unhealthy service, and optionally sends an alert
# if it's still unhealthy afterwards. Meant to run periodically INSIDE the
# container - see nisorga-schedule.sh (--task healthcheck).
#
# Exit code is 0 if every service ended up healthy, 1 otherwise - usable
# both for the alerting below and for external monitoring that only cares
# about the exit code (e.g. a systemd OnFailure= unit, or an external
# uptime checker invoking this over SSH).
#
# Usage:
#   ./nisorga-healthcheck.sh [options]
#
# Options:
#   --dir <path>              Install directory (default: /opt/nisorga)
#   --no-restart                 Don't try 'docker compose restart' on an
#                                   unhealthy service before alerting
#   --alert-email <address>         Send an alert email here on failure
#                                      (via SMTP_* in backend/.env - the
#                                      Settings-UI mail config, being
#                                      DB-only, isn't reachable from this
#                                      plain shell script)
#   --webhook-url <url>                Also/instead POST a JSON {"text":...}
#                                         alert here on failure (e.g. a
#                                         Slack/Discord/ntfy.sh webhook)
#   --dry-run                             Print what would be done without
#                                            changing anything
#   -h, --help                               Show this help text

set -uo pipefail

INSTALL_DIR="/opt/nisorga"
NO_RESTART=false
ALERT_EMAIL=""
WEBHOOK_URL=""
DRY_RUN=false

SERVICES=(postgres backend frontend)

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

print_help() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        --no-restart) NO_RESTART=true ;;
        --alert-email) ALERT_EMAIL="${2:-}"; shift ;;
        --webhook-url) WEBHOOK_URL="${2:-}"; shift ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    log ERROR "$INSTALL_DIR/docker-compose.yml not found - this script expects a Docker Compose install (see nisorga-app-install.sh)."
    exit 1
fi
cd "$INSTALL_DIR"

send_alert() {
    local subject="$1" body="$2"

    if [[ -n "$WEBHOOK_URL" ]]; then
        log INFO "Posting alert to webhook"
        if ! $DRY_RUN; then
            curl -fsS -X POST -H 'Content-Type: application/json' \
                -d "$(printf '{"text":"%s: %s"}' "$subject" "$body")" \
                "$WEBHOOK_URL" >/dev/null || log WARN "Failed to post webhook alert"
        fi
    fi

    if [[ -n "$ALERT_EMAIL" ]]; then
        local smtp_host smtp_port smtp_secure smtp_user smtp_password smtp_from
        smtp_host="$(grep -oP '^SMTP_HOST=\K.*' backend/.env 2>/dev/null | tr -d '"')"
        if [[ -z "$smtp_host" ]]; then
            log WARN "--alert-email given but SMTP_HOST is not set in backend/.env - skipping email alert."
            return
        fi
        smtp_port="$(grep -oP '^SMTP_PORT=\K.*' backend/.env 2>/dev/null | tr -d '"')"; smtp_port="${smtp_port:-587}"
        smtp_secure="$(grep -oP '^SMTP_SECURE=\K.*' backend/.env 2>/dev/null | tr -d '"')"
        smtp_user="$(grep -oP '^SMTP_USER=\K.*' backend/.env 2>/dev/null | tr -d '"')"
        smtp_password="$(grep -oP '^SMTP_PASSWORD=\K.*' backend/.env 2>/dev/null | tr -d '"')"
        smtp_from="$(grep -oP '^SMTP_FROM_EMAIL=\K.*' backend/.env 2>/dev/null | tr -d '"')"; smtp_from="${smtp_from:-noreply@example.com}"

        log INFO "Sending alert email to $ALERT_EMAIL via $smtp_host"
        if ! $DRY_RUN; then
            local curl_args=(--url "smtp://${smtp_host}:${smtp_port}" --mail-from "$smtp_from" --mail-rcpt "$ALERT_EMAIL")
            [[ "$smtp_secure" == "true" ]] && curl_args+=(--ssl-reqd)
            [[ -n "$smtp_user" ]] && curl_args+=(--user "${smtp_user}:${smtp_password}")
            printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n' "$smtp_from" "$ALERT_EMAIL" "$subject" "$body" \
                | curl -fsS "${curl_args[@]}" --upload-file - >/dev/null || log WARN "Failed to send alert email"
        fi
    fi
}

overall_ok=true
for service in "${SERVICES[@]}"; do
    container_id="$(docker compose ps -q "$service" 2>/dev/null)"
    if [[ -z "$container_id" ]]; then
        log ERROR "$service: no container found (not running?)"
        overall_ok=false
        send_alert "Nisorga: $service down" "No container found for service '$service' in $INSTALL_DIR."
        continue
    fi

    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null)"
    if [[ "$status" == "healthy" || "$status" == "no-healthcheck" ]]; then
        log OK "$service: $status"
        continue
    fi

    log WARN "$service: $status"
    if ! $NO_RESTART; then
        log INFO "Restarting $service"
        if $DRY_RUN; then
            log INFO "[dry-run] docker compose restart $service"
        else
            docker compose restart "$service" >/dev/null 2>&1
            sleep 10
            status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null)"
        fi
    fi

    if [[ "$status" == "healthy" || "$status" == "no-healthcheck" ]]; then
        log OK "$service: $status after restart"
    else
        log ERROR "$service: still $status"
        overall_ok=false
        send_alert "Nisorga: $service unhealthy" "Service '$service' in $INSTALL_DIR is '$status'$($NO_RESTART || echo ' (restart attempted)')."
    fi
done

$overall_ok && exit 0 || exit 1
