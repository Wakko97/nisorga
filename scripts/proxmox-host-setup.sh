#!/usr/bin/env bash
#
# proxmox-host-setup.sh
#
# Post-installation setup script for a fresh Proxmox VE host.
# Configures APT repositories (no-subscription), removes the subscription
# nag screen, updates the system, installs common tools and sets up
# time synchronization.
#
# Usage:
#   sudo ./proxmox-host-setup.sh [options]
#
# Options:
#   --yes, -y            Do not ask for confirmation before each step
#   --dry-run            Print what would be done without changing anything
#   --skip-repo          Skip APT repository reconfiguration
#   --skip-update         Skip "apt update && apt full-upgrade"
#   --skip-nag            Skip removal of the subscription nag screen
#   --skip-tools           Skip installation of common CLI tools
#   --skip-time             Skip timezone/NTP configuration
#   --timezone <tz>          Set a specific timezone (e.g. Europe/Berlin)
#   -h, --help                Show this help text
#
# The script is idempotent: running it multiple times will not duplicate
# repository entries or break an already-patched system.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration / defaults
# ---------------------------------------------------------------------------

ASSUME_YES=false
DRY_RUN=false
SKIP_REPO=false
SKIP_UPDATE=false
SKIP_NAG=false
SKIP_TOOLS=false
SKIP_TIME=false
TIMEZONE=""

LOG_FILE="/var/log/proxmox-host-setup.log"

COMMON_PACKAGES=(
    curl
    wget
    vim
    htop
    iotop
    unzip
    git
    net-tools
    sudo
    gnupg
    lsb-release
    ca-certificates
    chrony
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

COLOR_RESET="\e[0m"
COLOR_GREEN="\e[32m"
COLOR_YELLOW="\e[33m"
COLOR_RED="\e[31m"
COLOR_BLUE="\e[34m"

log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in
        INFO)  color="$COLOR_BLUE" ;;
        OK)    color="$COLOR_GREEN" ;;
        WARN)  color="$COLOR_YELLOW" ;;
        ERROR) color="$COLOR_RED" ;;
    esac
    local msg
    msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
    echo -e "${color}${msg}${COLOR_RESET}"
    if [[ -w "$(dirname "$LOG_FILE")" || -w "$LOG_FILE" ]] 2>/dev/null; then
        echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
    fi
}

run() {
    # Executes a command, or prints it in dry-run mode.
    if $DRY_RUN; then
        log INFO "[dry-run] $*"
    else
        "$@"
    fi
}

confirm() {
    local prompt="$1"
    if $ASSUME_YES; then
        return 0
    fi
    read -r -p "$prompt [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log ERROR "This script must be run as root (use sudo)."
        exit 1
    fi
}

require_proxmox() {
    if ! command -v pveversion >/dev/null 2>&1; then
        log ERROR "pveversion not found - this does not look like a Proxmox VE host."
        exit 1
    fi
    log INFO "Detected: $(pveversion)"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

print_help() {
    sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes|-y) ASSUME_YES=true ;;
        --dry-run) DRY_RUN=true ;;
        --skip-repo) SKIP_REPO=true ;;
        --skip-update) SKIP_UPDATE=true ;;
        --skip-nag) SKIP_NAG=true ;;
        --skip-tools) SKIP_TOOLS=true ;;
        --skip-time) SKIP_TIME=true ;;
        --timezone) TIMEZONE="${2:-}"; shift ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

configure_repositories() {
    log INFO "== Configuring APT repositories =="

    local codename
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    if [[ -z "$codename" ]]; then
        log ERROR "Could not determine Debian codename from /etc/os-release."
        return 1
    fi
    log INFO "Debian codename: $codename"

    # Disable enterprise repositories (classic .list and new deb822 .sources).
    shopt -s nullglob
    local f
    for f in /etc/apt/sources.list.d/*enterprise*.list; do
        if grep -q '^deb ' "$f" 2>/dev/null; then
            log INFO "Disabling enterprise repo: $f"
            run cp "$f" "$f.bak"
            run sed -i 's/^deb /#deb /' "$f"
        fi
    done
    for f in /etc/apt/sources.list.d/*enterprise*.sources; do
        if grep -qi '^Enabled: *yes' "$f" 2>/dev/null; then
            log INFO "Disabling enterprise repo: $f"
            run cp "$f" "$f.bak"
            run sed -i 's/^Enabled: *yes/Enabled: no/I' "$f"
        elif ! grep -qi '^Enabled:' "$f" 2>/dev/null; then
            log INFO "Disabling enterprise repo: $f"
            run cp "$f" "$f.bak"
            run bash -c "echo 'Enabled: no' >> '$f'"
        fi
    done
    shopt -u nullglob

    # Add the no-subscription repository (classic list format works on all
    # currently supported Proxmox VE releases).
    local repo_file="/etc/apt/sources.list.d/pve-no-subscription.list"
    local repo_line="deb http://download.proxmox.com/debian/pve ${codename} pve-no-subscription"

    if [[ -f "$repo_file" ]] && grep -qF "$repo_line" "$repo_file"; then
        log OK "No-subscription repository already configured."
    else
        log INFO "Adding no-subscription repository."
        run bash -c "echo '$repo_line' > '$repo_file'"
    fi

    # Ceph enterprise repo: only disable, do not guess a Ceph release name.
    for f in /etc/apt/sources.list.d/*ceph*.list; do
        if grep -q '^deb ' "$f" 2>/dev/null; then
            log WARN "Disabling Ceph enterprise repo: $f (add the matching no-subscription Ceph repo manually if Ceph is in use)."
            run cp "$f" "$f.bak"
            run sed -i 's/^deb /#deb /' "$f"
        fi
    done

    log OK "Repository configuration done."
}

update_system() {
    log INFO "== Updating system packages =="
    if ! $ASSUME_YES && ! confirm "Run 'apt update && apt full-upgrade -y' now?"; then
        log WARN "Skipping system update."
        return 0
    fi
    run apt-get update
    run apt-get full-upgrade -y
    log OK "System update done."
}

remove_subscription_nag() {
    log INFO "== Removing subscription nag screen =="

    local js_file="/usr/share/javascript/proxmox-widget-toolkit/proxmox-lib.js"
    if [[ ! -f "$js_file" ]]; then
        log WARN "$js_file not found, skipping."
        return 0
    fi

    if grep -q "NoMoreNagging" "$js_file" 2>/dev/null; then
        log OK "Subscription nag already removed."
    else
        log INFO "Patching $js_file"
        run cp "$js_file" "$js_file.orig-$(date +%s)"
        run sed -i.bak -zE \
            "s/(function\(orig_cmd\) \{)/\1 orig_cmd(); return; \/\* NoMoreNagging \*\//" \
            "$js_file" || log WARN "Patch pattern not found (widget-toolkit version may differ); nag may reappear."
    fi

    # Re-apply the patch automatically whenever pve-manager gets upgraded,
    # so the change survives Proxmox VE updates.
    local hook_file="/etc/apt/apt.conf.d/xx-pve-no-nag"
    local hook_content
    hook_content='DPkg::Post-Invoke { "dpkg -l pve-manager 2>/dev/null | grep -q '"'"'^ii'"'"' && { echo '"'"'Re-applying subscription nag removal'"'"'; sed -i -zE '"'"'s/(function\\(orig_cmd\\) \\{)/\\1 orig_cmd(); return;/'"'"' /usr/share/javascript/proxmox-widget-toolkit/proxmox-lib.js 2>/dev/null; } || true"; };'

    if [[ -f "$hook_file" ]] && grep -qF "Re-applying subscription nag removal" "$hook_file"; then
        log OK "APT post-invoke hook already in place."
    else
        log INFO "Installing APT post-invoke hook: $hook_file"
        run bash -c "cat > '$hook_file' <<'EOF'
$hook_content
EOF"
    fi

    log OK "Subscription nag removal done. A browser reload (Ctrl+F5) may be required."
}

install_common_tools() {
    log INFO "== Installing common tools =="
    if ! $ASSUME_YES && ! confirm "Install common CLI tools (${COMMON_PACKAGES[*]})?"; then
        log WARN "Skipping tool installation."
        return 0
    fi
    run apt-get install -y "${COMMON_PACKAGES[@]}"
    log OK "Tool installation done."
}

configure_time() {
    log INFO "== Configuring timezone and NTP =="

    if [[ -n "$TIMEZONE" ]]; then
        if [[ -f "/usr/share/zoneinfo/$TIMEZONE" ]]; then
            log INFO "Setting timezone to $TIMEZONE"
            run timedatectl set-timezone "$TIMEZONE"
        else
            log ERROR "Unknown timezone: $TIMEZONE (skipping)"
        fi
    else
        log INFO "Current timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo unknown) (use --timezone to change it)"
    fi

    if systemctl list-unit-files | grep -q '^chrony.service'; then
        log INFO "Enabling chrony for time synchronization."
        run systemctl enable --now chrony
    else
        log INFO "chrony not installed, ensuring systemd-timesyncd is active."
        run timedatectl set-ntp true
    fi

    log OK "Time configuration done."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    require_root
    require_proxmox

    log INFO "Starting Proxmox VE host setup (dry-run: $DRY_RUN)"

    $SKIP_REPO   || configure_repositories
    $SKIP_UPDATE || update_system
    $SKIP_NAG    || remove_subscription_nag
    $SKIP_TOOLS  || install_common_tools
    $SKIP_TIME   || configure_time

    log OK "Proxmox VE host setup finished."
    log INFO "A reboot is recommended if the kernel was updated: 'reboot'"
}

main "$@"
