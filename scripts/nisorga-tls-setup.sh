#!/usr/bin/env bash
#
# nisorga-tls-setup.sh
#
# Sets up a Caddy reverse proxy in front of the Nisorga frontend, with
# automatic HTTPS (Let's Encrypt) for a given domain. Runs INSIDE the
# container. This is an alternative to docs/deployment.md's "Variante (b)"
# (anbinding an einen bereits laufenden Nginx Proxy Manager) for anyone who
# doesn't already have a reverse proxy running elsewhere.
#
# Requirements (not handled by this script):
#   - A domain (or subdomain) whose DNS A/AAAA record points at this
#     container's public IP (directly, or via port forwarding on your
#     router to the Proxmox host and then this container).
#   - Ports 80 and 443 reachable from the internet on that IP - Caddy
#     needs port 80 for the ACME HTTP-01 challenge and serves HTTPS on 443.
#
# Usage:
#   ./nisorga-tls-setup.sh --domain <fqdn> [options]
#   ./nisorga-tls-setup.sh --disable
#
# Options:
#   --domain <fqdn>      Domain Caddy should request a certificate for and
#                           serve the app on (required unless --disable)
#   --email <address>       Contact address Let's Encrypt may use for
#                              expiry/problem notices (optional but recommended)
#   --dir <path>                Install directory (default: /opt/nisorga)
#   --disable                      Stop and remove the Caddy service again
#   --dry-run                         Print what would be done without
#                                        changing anything
#   -h, --help                           Show this help text

set -euo pipefail

DOMAIN=""
EMAIL=""
INSTALL_DIR="/opt/nisorga"
DISABLE=false
DRY_RUN=false

OVERRIDE_FILE_NAME="docker-compose.tls.yml"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

run() {
    if $DRY_RUN; then
        log INFO "[dry-run] $*"
    else
        "$@"
    fi
}

print_help() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; shift ;;
        --email) EMAIL="${2:-}"; shift ;;
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        --disable) DISABLE=true ;;
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

compose_files=(-f docker-compose.yml -f "$OVERRIDE_FILE_NAME")

if $DISABLE; then
    log INFO "Stopping and removing the Caddy service"
    run docker compose "${compose_files[@]}" stop caddy 2>/dev/null || true
    run docker compose "${compose_files[@]}" rm -f caddy 2>/dev/null || true
    run rm -f "$OVERRIDE_FILE_NAME" Caddyfile
    log OK "Caddy disabled. Bring the app back up without it: docker compose up -d"
    exit 0
fi

if [[ -z "$DOMAIN" ]]; then
    log ERROR "--domain is required."
    print_help
    exit 1
fi

log INFO "Writing Caddyfile for $DOMAIN"
if $DRY_RUN; then
    log INFO "[dry-run] would write Caddyfile"
else
    {
        if [[ -n "$EMAIL" ]]; then
            echo "{"
            echo "    email $EMAIL"
            echo "}"
            echo
        fi
        echo "$DOMAIN {"
        echo "    reverse_proxy frontend:80"
        echo "}"
    } > Caddyfile
fi

log INFO "Writing $OVERRIDE_FILE_NAME"
if $DRY_RUN; then
    log INFO "[dry-run] would write $OVERRIDE_FILE_NAME"
else
    cat > "$OVERRIDE_FILE_NAME" <<'EOF'
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
    networks:
      - internal

volumes:
  caddy_data:
  caddy_config:
EOF
fi

log INFO "Starting Caddy (this requests the Let's Encrypt certificate for $DOMAIN)"
run docker compose "${compose_files[@]}" up -d caddy

log OK "TLS set up. Once DNS for $DOMAIN points here and ports 80/443 are reachable, the app is available at https://$DOMAIN"
log INFO "Check certificate issuance with: docker compose ${compose_files[*]} logs -f caddy"
