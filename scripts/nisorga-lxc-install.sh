#!/usr/bin/env bash
#
# nisorga-lxc-install.sh
#
# Run this script IN THE PROXMOX VE SHELL (as root on the Proxmox host).
# It creates a new unprivileged LXC container and installs the Nisorga
# application into it (via nisorga-app-install.sh).
#
# Quick start on the Proxmox host:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-lxc-install.sh)
#
# Or, if the repo is already checked out on the host:
#   cd /path/to/nisorga && sudo ./scripts/nisorga-lxc-install.sh
#
# Options:
#   --ctid <id>              Container ID (default: next free ID)
#   --hostname <name>        Container hostname (default: nisorga)
#   --storage <name>         Storage for the container rootfs (default: auto-detected)
#   --template-storage <n>   Storage holding the LXC template (default: auto-detected)
#   --bridge <name>          Network bridge (default: vmbr0)
#   --ip <cidr|dhcp>         Static IP as CIDR (e.g. 192.168.1.50/24) or "dhcp" (default: dhcp)
#   --gateway <ip>           Gateway IP, required when --ip is static
#   --cores <n>               CPU cores (default: 2)
#   --memory <MB>              RAM in MB (default: 1024)
#   --swap <MB>                 Swap in MB (default: 512)
#   --disk <GB>                    Root disk size in GB (default: 4)
#   --password <pass>                Root password (default: randomly generated)
#   --repo <url>                       Nisorga git repo URL (default: https://github.com/Wakko97/nisorga.git)
#   --branch <name>                     Git branch to deploy (default: main)
#   --privileged                          Create a privileged container (default: unprivileged)
#   --yes, -y                              Do not ask for confirmation
#   --dry-run                                Print what would be done without changing anything
#   -h, --help                                 Show this help text

set -euo pipefail

CTID=""
CT_HOSTNAME="nisorga"
STORAGE=""
TEMPLATE_STORAGE=""
BRIDGE="vmbr0"
IP="dhcp"
GATEWAY=""
CORES=2
MEMORY=1024
SWAP=512
DISK=4
ROOT_PASSWORD=""
REPO_URL="https://github.com/Wakko97/nisorga.git"
BRANCH="main"
UNPRIVILEGED=1
ASSUME_YES=false
DRY_RUN=false

TEMPLATE_PATTERN="debian-12-standard"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
APP_INSTALL_SCRIPT="$SCRIPT_DIR/nisorga-app-install.sh"
APP_INSTALL_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-app-install.sh"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    # Always write to stderr: several functions below return data on stdout
    # via command substitution (e.g. ensure_template), and log() output must
    # never leak into that captured value.
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}" >&2
}

run() {
    if $DRY_RUN; then
        log INFO "[dry-run] $*"
    else
        "$@"
    fi
}

confirm() {
    local prompt="$1"
    $ASSUME_YES && return 0
    read -r -p "$prompt [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

print_help() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ctid) CTID="${2:-}"; shift ;;
        --hostname) CT_HOSTNAME="${2:-}"; shift ;;
        --storage) STORAGE="${2:-}"; shift ;;
        --template-storage) TEMPLATE_STORAGE="${2:-}"; shift ;;
        --bridge) BRIDGE="${2:-}"; shift ;;
        --ip) IP="${2:-}"; shift ;;
        --gateway) GATEWAY="${2:-}"; shift ;;
        --cores) CORES="${2:-}"; shift ;;
        --memory) MEMORY="${2:-}"; shift ;;
        --swap) SWAP="${2:-}"; shift ;;
        --disk) DISK="${2:-}"; shift ;;
        --password) ROOT_PASSWORD="${2:-}"; shift ;;
        --repo) REPO_URL="${2:-}"; shift ;;
        --branch) BRANCH="${2:-}"; shift ;;
        --privileged) UNPRIVILEGED=0 ;;
        --yes|-y) ASSUME_YES=true ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

require_root() {
    [[ "$(id -u)" -eq 0 ]] || { log ERROR "This script must be run as root."; exit 1; }
}

require_proxmox() {
    command -v pct >/dev/null 2>&1 || { log ERROR "'pct' not found - this script must run on a Proxmox VE host."; exit 1; }
    command -v pveam >/dev/null 2>&1 || { log ERROR "'pveam' not found - this script must run on a Proxmox VE host."; exit 1; }
}

resolve_storage() {
    local content="$1" name_var="$2"
    local current="${!name_var}"

    if [[ -n "$current" ]]; then
        if ! pvesm status --content "$content" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}' | grep -qxF "$current"; then
            log ERROR "Storage '$current' does not exist or is not active/does not support content type '$content'. Available storages for '$content':"
            pvesm status --content "$content" 2>/dev/null >&2
            exit 1
        fi
        return
    fi

    local detected
    detected="$(pvesm status --content "$content" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
    if [[ -z "$detected" ]]; then
        log ERROR "No active storage with content type '$content' found. Configure one in the Proxmox UI (Datacenter -> Storage) or pass it explicitly."
        pvesm status 2>/dev/null >&2
        exit 1
    fi
    printf -v "$name_var" '%s' "$detected"
    log INFO "Auto-detected storage for '$content': $detected"
}

pick_ctid() {
    if [[ -z "$CTID" ]]; then
        CTID="$(pvesh get /cluster/nextid)"
        log INFO "No --ctid given, using next free ID: $CTID"
    fi
    if pct status "$CTID" >/dev/null 2>&1; then
        log ERROR "Container ID $CTID already exists."
        exit 1
    fi
}

# Sets the global TEMPLATE_VOLID instead of returning via stdout: this
# function shells out to 'pveam update'/'pveam download', whose own stdout
# output ("update successful", download progress, ...) must never be mixed
# into a captured return value - a $(ensure_template) command substitution
# would silently swallow all of that output into the "return value" too.
TEMPLATE_VOLID=""
ensure_template() {
    log INFO "Updating LXC template index"
    run pveam update || log WARN "'pveam update' failed (offline or no subscription repo access?) - falling back to the cached template index / already-downloaded templates."

    local template
    template="$(pveam available --section system 2>/dev/null | grep "$TEMPLATE_PATTERN" | awk '{print $2}' | sort -V | tail -n1)"

    if [[ -z "$template" ]]; then
        log WARN "No downloadable template matching '$TEMPLATE_PATTERN' found via 'pveam available', checking templates already present on '$TEMPLATE_STORAGE'."
        template="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk '{print $1}' | grep "$TEMPLATE_PATTERN" | xargs -n1 basename 2>/dev/null | sort -V | tail -n1)"
    fi

    if [[ -z "$template" ]]; then
        log ERROR "No template matching '$TEMPLATE_PATTERN' found (neither downloadable via 'pveam available' nor already present on '$TEMPLATE_STORAGE')."
        exit 1
    fi

    if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$template"; then
        log INFO "Downloading template $template to storage '$TEMPLATE_STORAGE'"
        run pveam download "$TEMPLATE_STORAGE" "$template"
    else
        log OK "Template $template already present on '$TEMPLATE_STORAGE'."
    fi

    TEMPLATE_VOLID="$TEMPLATE_STORAGE:vztmpl/$template"
}

create_container() {
    local template_volid="$1"

    local net0="name=eth0,bridge=${BRIDGE}"
    if [[ "$IP" == "dhcp" ]]; then
        net0="${net0},ip=dhcp"
    else
        [[ -n "$GATEWAY" ]] || { log ERROR "--gateway is required when --ip is a static address."; exit 1; }
        net0="${net0},ip=${IP},gw=${GATEWAY}"
    fi

    if [[ -z "$ROOT_PASSWORD" ]]; then
        ROOT_PASSWORD="$(openssl rand -base64 12)"
        log INFO "No --password given, generated a random root password."
    fi

    log INFO "Creating container $CTID ($CT_HOSTNAME) on storage '$STORAGE' with template $template_volid"
    run pct create "$CTID" "$template_volid" \
        -hostname "$CT_HOSTNAME" \
        -cores "$CORES" \
        -memory "$MEMORY" \
        -swap "$SWAP" \
        -net0 "$net0" \
        -rootfs "${STORAGE}:${DISK}" \
        -unprivileged "$UNPRIVILEGED" \
        -features nesting=1 \
        -onboot 1 \
        -password "$ROOT_PASSWORD"

    log OK "Container $CTID created."
}

start_container_and_wait() {
    log INFO "Starting container $CTID"
    run pct start "$CTID"

    if $DRY_RUN; then
        return
    fi

    log INFO "Waiting for network connectivity inside the container..."
    local i
    for i in $(seq 1 30); do
        if pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1; then
            log OK "Container network is up."
            return
        fi
        sleep 2
    done
    log WARN "Could not confirm network connectivity after 60s, continuing anyway."
}

install_app() {
    if $DRY_RUN; then
        log INFO "[dry-run] would push and run nisorga-app-install.sh inside container $CTID"
        return
    fi

    local remote_script="/root/nisorga-app-install.sh"
    local local_script="$APP_INSTALL_SCRIPT"
    local tmp_script=""

    if [[ ! -f "$local_script" ]]; then
        # Common case: this script itself was run via 'bash <(curl ...)', so
        # there is no local checkout to read nisorga-app-install.sh from.
        # Download it here on the Proxmox host (which definitely has curl -
        # it's how we got this far) rather than inside the freshly created
        # container, which is a minimal template and may not have curl/wget
        # installed yet.
        log INFO "Local install script not found, downloading it to the Proxmox host first"
        tmp_script="$(mktemp)"
        curl -fsSL "$APP_INSTALL_URL" -o "$tmp_script"
        local_script="$tmp_script"
    fi

    log INFO "Pushing nisorga-app-install.sh into container"
    pct push "$CTID" "$local_script" "$remote_script"
    [[ -n "$tmp_script" ]] && rm -f "$tmp_script"
    pct exec "$CTID" -- chmod +x "$remote_script"

    log INFO "Running application installer inside container $CTID"
    pct exec "$CTID" -- "$remote_script" --repo "$REPO_URL" --branch "$BRANCH"
}

main() {
    require_root
    require_proxmox
    pick_ctid
    resolve_storage rootdir STORAGE
    resolve_storage vztmpl TEMPLATE_STORAGE

    log INFO "About to create LXC $CTID ($CT_HOSTNAME): $CORES vCPU, ${MEMORY}MB RAM, ${DISK}GB disk, storage=$STORAGE, bridge=$BRIDGE, ip=$IP"
    confirm "Proceed with container creation?" || { log WARN "Aborted by user."; exit 0; }

    ensure_template
    create_container "$TEMPLATE_VOLID"
    start_container_and_wait
    install_app

    log OK "Nisorga installation finished in container $CTID."
    if [[ -n "$ROOT_PASSWORD" ]]; then
        log INFO "Container root password: $ROOT_PASSWORD"
    fi
    log INFO "Enter the container with: pct enter $CTID"
}

main "$@"
