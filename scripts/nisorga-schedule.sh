#!/usr/bin/env bash
#
# nisorga-schedule.sh
#
# Installs (or removes) a systemd timer INSIDE the container that runs
# nisorga-update.sh or nisorga-backup.sh on a recurring schedule, so
# updates/backups don't have to be triggered by hand every time.
#
# Usage:
#   ./nisorga-schedule.sh --task <update|backup> [options]
#   ./nisorga-schedule.sh --task <update|backup> --disable
#
# Options:
#   --task <update|backup>   Which script to schedule (required)
#   --schedule <expr>          systemd OnCalendar expression (default:
#                                 "03:00" for update, "02:00" for backup -
#                                 see `man systemd.time`)
#   --disable                     Remove the timer/service for --task
#                                    instead of installing it
#   --dry-run                        Print what would be done without
#                                       changing anything
#   -h, --help                          Show this help text
#
# Any remaining arguments after "--" are passed through to the scheduled
# script as-is, e.g.:
#   ./nisorga-schedule.sh --task update --schedule daily -- --branch main
#   ./nisorga-schedule.sh --task backup --schedule "02:00" -- --keep 14

set -euo pipefail

TASK=""
SCHEDULE=""
DISABLE=false
DRY_RUN=false
EXTRA_ARGS=()

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
RAW_BASE_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts"

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

print_help() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --task) TASK="${2:-}"; shift ;;
        --schedule) SCHEDULE="${2:-}"; shift ;;
        --disable) DISABLE=true ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        --) shift; EXTRA_ARGS=("$@"); break ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [[ "$TASK" != "update" && "$TASK" != "backup" ]]; then
    log ERROR "--task must be 'update' or 'backup'."
    print_help
    exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi

service_file="/etc/systemd/system/nisorga-${TASK}.service"
timer_file="/etc/systemd/system/nisorga-${TASK}.timer"

if $DISABLE; then
    log INFO "Disabling scheduled $TASK"
    run systemctl disable --now "nisorga-${TASK}.timer" 2>/dev/null || true
    run rm -f "$service_file" "$timer_file"
    run systemctl daemon-reload
    log OK "Scheduled $TASK disabled."
    exit 0
fi

[[ -n "$SCHEDULE" ]] || SCHEDULE="$([[ "$TASK" == "update" ]] && echo "03:00" || echo "02:00")"

target_script="/usr/local/bin/nisorga-${TASK}.sh"
local_script="$SCRIPT_DIR/nisorga-${TASK}.sh"
if [[ -f "$local_script" ]]; then
    log INFO "Installing nisorga-${TASK}.sh to $target_script"
    run cp "$local_script" "$target_script"
else
    log INFO "Local nisorga-${TASK}.sh not found, downloading it"
    run curl -fsSL "$RAW_BASE_URL/nisorga-${TASK}.sh" -o "$target_script"
fi
run chmod +x "$target_script"

exec_line="$target_script"
for arg in "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; do
    exec_line+=" $(printf '%q' "$arg")"
done

log INFO "Writing $service_file (ExecStart=$exec_line)"
if ! $DRY_RUN; then
    cat > "$service_file" <<EOF
[Unit]
Description=Nisorga scheduled ${TASK}

[Service]
Type=oneshot
ExecStart=${exec_line}
EOF
fi

log INFO "Writing $timer_file (OnCalendar=$SCHEDULE)"
if ! $DRY_RUN; then
    cat > "$timer_file" <<EOF
[Unit]
Description=Run nisorga-${TASK}.sh on a schedule

[Timer]
OnCalendar=${SCHEDULE}
Persistent=true

[Install]
WantedBy=timers.target
EOF
fi

run systemctl daemon-reload
run systemctl enable --now "nisorga-${TASK}.timer"

log OK "Scheduled $TASK enabled (OnCalendar=$SCHEDULE). Check with: systemctl list-timers nisorga-${TASK}.timer"
