#!/usr/bin/env bash
#
# nisorga-lxc-schedule.sh
#
# Run this script IN THE PROXMOX VE SHELL (as root on the Proxmox host) to
# enable (or disable) a recurring update/backup schedule inside a Nisorga
# LXC container, without having to `pct enter` it. Pushes
# nisorga-schedule.sh into the container and runs it there.
#
# Usage:
#   ./nisorga-lxc-schedule.sh --ctid <id> --task <update|backup> [options]
#   ./nisorga-lxc-schedule.sh --ctid <id> --task <update|backup> --disable
#
# Options:
#   --ctid <id>               Container ID (required)
#   --task <update|backup>      Which script to schedule (required)
#   --schedule <expr>              systemd OnCalendar expression (default:
#                                     "03:00" for update, "02:00" for backup)
#   --disable                         Remove the schedule for --task instead
#                                        of installing it
#   --dry-run                            Print what would be done without
#                                           changing anything
#   -h, --help                              Show this help text
#
# Any remaining arguments after "--" are passed through to the scheduled
# script, e.g.:
#   ./nisorga-lxc-schedule.sh --ctid 135 --task backup -- --keep 14

set -euo pipefail

CTID=""
TASK=""
SCHEDULE=""
DISABLE=false
DRY_RUN=false
EXTRA_ARGS=()

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCHEDULE_SCRIPT="$SCRIPT_DIR/nisorga-schedule.sh"
SCHEDULE_SCRIPT_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-schedule.sh"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

print_help() { sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ctid) CTID="${2:-}"; shift ;;
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

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi
command -v pct >/dev/null 2>&1 || { log ERROR "'pct' not found - this script must run on a Proxmox VE host."; exit 1; }

if [[ -z "$CTID" ]]; then log ERROR "--ctid is required."; print_help; exit 1; fi
if [[ "$TASK" != "update" && "$TASK" != "backup" ]]; then log ERROR "--task must be 'update' or 'backup'."; print_help; exit 1; fi
if ! pct status "$CTID" >/dev/null 2>&1; then log ERROR "Container $CTID does not exist."; exit 1; fi

if [[ "$(pct status "$CTID")" != "status: running" ]]; then
    log INFO "Container $CTID is not running, starting it."
    pct start "$CTID"
    sleep 2
fi

remote_script="/root/nisorga-schedule.sh"
if [[ -f "$SCHEDULE_SCRIPT" ]]; then
    log INFO "Pushing nisorga-schedule.sh into container $CTID"
    pct push "$CTID" "$SCHEDULE_SCRIPT" "$remote_script"
else
    log INFO "Local schedule script not found, downloading it to the Proxmox host first"
    tmp_script="$(mktemp)"
    curl -fsSL "$SCHEDULE_SCRIPT_URL" -o "$tmp_script"
    pct push "$CTID" "$tmp_script" "$remote_script"
    rm -f "$tmp_script"
fi
pct exec "$CTID" -- chmod +x "$remote_script"

args=(--task "$TASK")
[[ -n "$SCHEDULE" ]] && args+=(--schedule "$SCHEDULE")
$DISABLE && args+=(--disable)
$DRY_RUN && args+=(--dry-run)
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    args+=(--)
    args+=("${EXTRA_ARGS[@]}")
fi

log INFO "Configuring $TASK schedule inside container $CTID"
pct exec "$CTID" -- "$remote_script" "${args[@]}"
log OK "Done."
