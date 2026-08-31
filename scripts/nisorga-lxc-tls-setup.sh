#!/usr/bin/env bash
#
# nisorga-lxc-tls-setup.sh
#
# Run this script IN THE PROXMOX VE SHELL (as root on the Proxmox host) to
# set up (or remove) HTTPS via Caddy for a Nisorga LXC container. Pushes
# nisorga-tls-setup.sh into the container and runs it there.
#
# Usage:
#   ./nisorga-lxc-tls-setup.sh --ctid <id> --domain <fqdn> [options]
#   ./nisorga-lxc-tls-setup.sh --ctid <id> --disable
#
# Options:
#   --ctid <id>        Container ID (required)
#   --domain <fqdn>       Domain to serve the app on (required unless --disable)
#   --email <address>       Contact address for Let's Encrypt notices
#   --dir <path>                Install directory inside the container
#                                  (default: /opt/nisorga)
#   --disable                       Remove the Caddy service again
#   --dry-run                          Print what would be done without
#                                         changing anything
#   -h, --help                             Show this help text

set -euo pipefail

CTID=""
DOMAIN=""
EMAIL=""
INSTALL_DIR="/opt/nisorga"
DISABLE=false
DRY_RUN=false

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
TLS_SCRIPT="$SCRIPT_DIR/nisorga-tls-setup.sh"
TLS_SCRIPT_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-tls-setup.sh"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

print_help() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ctid) CTID="${2:-}"; shift ;;
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

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi
command -v pct >/dev/null 2>&1 || { log ERROR "'pct' not found - this script must run on a Proxmox VE host."; exit 1; }

if [[ -z "$CTID" ]]; then log ERROR "--ctid is required."; print_help; exit 1; fi
if [[ -z "$DOMAIN" && "$DISABLE" == false ]]; then log ERROR "--domain is required unless --disable is given."; print_help; exit 1; fi
if ! pct status "$CTID" >/dev/null 2>&1; then log ERROR "Container $CTID does not exist."; exit 1; fi

if [[ "$(pct status "$CTID")" != "status: running" ]]; then
    log INFO "Container $CTID is not running, starting it."
    pct start "$CTID"
    sleep 2
fi

remote_script="/root/nisorga-tls-setup.sh"
if [[ -f "$TLS_SCRIPT" ]]; then
    log INFO "Pushing nisorga-tls-setup.sh into container $CTID"
    pct push "$CTID" "$TLS_SCRIPT" "$remote_script"
else
    log INFO "Local TLS script not found, downloading it to the Proxmox host first"
    tmp_script="$(mktemp)"
    curl -fsSL "$TLS_SCRIPT_URL" -o "$tmp_script"
    pct push "$CTID" "$tmp_script" "$remote_script"
    rm -f "$tmp_script"
fi
pct exec "$CTID" -- chmod +x "$remote_script"

args=(--dir "$INSTALL_DIR")
if $DISABLE; then
    args+=(--disable)
else
    args+=(--domain "$DOMAIN")
    [[ -n "$EMAIL" ]] && args+=(--email "$EMAIL")
fi
$DRY_RUN && args+=(--dry-run)

log INFO "Configuring TLS inside container $CTID"
pct exec "$CTID" -- "$remote_script" "${args[@]}"
log OK "Done."
