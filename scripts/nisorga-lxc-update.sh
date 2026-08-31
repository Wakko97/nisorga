#!/usr/bin/env bash
#
# nisorga-lxc-update.sh
#
# Run this script IN THE PROXMOX VE SHELL (as root on the Proxmox host) to
# update an existing Nisorga LXC container (created by
# nisorga-lxc-install.sh) to the latest code. Pushes nisorga-update.sh into
# the container and runs it there.
#
# Usage:
#   ./nisorga-lxc-update.sh --ctid <id> [options]
#
# Options:
#   --ctid <id>          Container ID to update (required)
#   --branch <name>        Git branch to update to (default: main) - used
#                             unless --zip is given
#   --zip <path>              Path to a GitHub-exported zip file ON THE
#                                PROXMOX HOST (e.g. downloaded via "Code ->
#                                Download ZIP" in the browser and uploaded
#                                here) to install from instead of git
#   --dir <path>                Install directory inside the container
#                                  (default: /opt/nisorga)
#   --dry-run                      Print what would be done without changing
#                                     anything
#   -h, --help                        Show this help text

set -euo pipefail

CTID=""
BRANCH="main"
ZIP_PATH=""
INSTALL_DIR="/opt/nisorga"
DRY_RUN=false

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
UPDATE_SCRIPT="$SCRIPT_DIR/nisorga-update.sh"
UPDATE_SCRIPT_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-update.sh"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

print_help() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ctid) CTID="${2:-}"; shift ;;
        --branch) BRANCH="${2:-}"; shift ;;
        --zip) ZIP_PATH="${2:-}"; shift ;;
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi

command -v pct >/dev/null 2>&1 || { log ERROR "'pct' not found - this script must run on a Proxmox VE host."; exit 1; }

if [[ -z "$CTID" ]]; then
    log ERROR "--ctid is required."
    print_help
    exit 1
fi

if ! pct status "$CTID" >/dev/null 2>&1; then
    log ERROR "Container $CTID does not exist."
    exit 1
fi

if [[ -n "$ZIP_PATH" ]]; then
    if [[ ! -f "$ZIP_PATH" ]]; then
        log ERROR "Zip file not found: $ZIP_PATH"
        exit 1
    fi
fi

if [[ "$(pct status "$CTID")" != "status: running" ]]; then
    log INFO "Container $CTID is not running, starting it."
    pct start "$CTID"
    sleep 2
fi

remote_script="/root/nisorga-update.sh"
if [[ -f "$UPDATE_SCRIPT" ]]; then
    log INFO "Pushing nisorga-update.sh into container $CTID"
    pct push "$CTID" "$UPDATE_SCRIPT" "$remote_script"
else
    log INFO "Local update script not found, downloading it to the Proxmox host first"
    tmp_script="$(mktemp)"
    curl -fsSL "$UPDATE_SCRIPT_URL" -o "$tmp_script"
    pct push "$CTID" "$tmp_script" "$remote_script"
    rm -f "$tmp_script"
fi
pct exec "$CTID" -- chmod +x "$remote_script"

update_args=(--dir "$INSTALL_DIR")
$DRY_RUN && update_args+=(--dry-run)

if [[ -n "$ZIP_PATH" ]]; then
    remote_zip="/root/nisorga-update.zip"
    log INFO "Pushing $ZIP_PATH into container $CTID"
    pct push "$CTID" "$ZIP_PATH" "$remote_zip"
    update_args+=(--zip "$remote_zip")
else
    update_args+=(--branch "$BRANCH")
fi

log INFO "Running update inside container $CTID"
pct exec "$CTID" -- "$remote_script" "${update_args[@]}"

log OK "Update of container $CTID finished."
