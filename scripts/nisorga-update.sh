#!/usr/bin/env bash
#
# nisorga-update.sh
#
# Updates an existing Nisorga installation in place (created by
# nisorga-app-install.sh) and rebuilds/restarts it. Runs INSIDE the
# container - either directly, or pushed and executed by
# nisorga-lxc-update.sh from the Proxmox shell.
#
# Two ways to get the new code:
#   1. git (default): fetch + hard-reset the existing checkout to the
#      latest commit of --branch.
#   2. A GitHub zip export: pass --zip (a local .zip already on this
#      machine) or --zip-url (downloaded first, e.g. a GitHub
#      "Download ZIP" link, a specific commit/tag archive, or a Release
#      asset). Useful when git access isn't available, or to pin an
#      update to a specific downloaded snapshot. .env files and uploaded
#      attachments are never touched by either mode.
#
# Usage:
#   ./nisorga-update.sh [options]
#
# Options:
#   --dir <path>        Install directory (default: /opt/nisorga)
#   --branch <name>      Git branch to update to in git mode (default: main)
#   --zip <path>           Local zip file to install from instead of git
#   --zip-url <url>          Download a zip from this URL and install from it
#   --dry-run                  Print what would be done without changing anything
#   -h, --help                    Show this help text

set -euo pipefail

INSTALL_DIR="/opt/nisorga"
BRANCH="main"
ZIP_PATH=""
ZIP_URL=""
DRY_RUN=false

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
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        --branch) BRANCH="${2:-}"; shift ;;
        --zip) ZIP_PATH="${2:-}"; shift ;;
        --zip-url) ZIP_URL="${2:-}"; shift ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [[ -n "$ZIP_PATH" && -n "$ZIP_URL" ]]; then
    log ERROR "--zip and --zip-url are mutually exclusive."
    exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
    log ERROR "$INSTALL_DIR does not exist. Run nisorga-app-install.sh first."
    exit 1
fi

update_via_git() {
    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log ERROR "$INSTALL_DIR is not a git checkout. Use --zip/--zip-url instead, or reinstall with nisorga-app-install.sh."
        exit 1
    fi
    log INFO "Updating $INSTALL_DIR via git (branch: $BRANCH)"
    run git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    run git -C "$INSTALL_DIR" checkout "$BRANCH"
    run git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
}

update_via_zip() {
    local zip_file="$1"

    log INFO "Installing dependencies needed to unpack the zip archive (unzip, rsync)"
    export DEBIAN_FRONTEND=noninteractive
    run apt-get update -y
    run apt-get install -y --no-install-recommends unzip rsync

    local extract_dir
    extract_dir="$(mktemp -d)"
    log INFO "Extracting $zip_file"
    run unzip -q "$zip_file" -d "$extract_dir"

    # GitHub zip exports (branch/tag/commit "Download ZIP", and codeload
    # archives) always contain exactly one top-level directory - use that as
    # the source root rather than assuming a fixed name (it encodes the
    # repo + ref, e.g. "nisorga-main/").
    local source_root
    source_root="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    if [[ -z "$source_root" ]]; then
        log ERROR "Could not find an extracted top-level directory in $zip_file - is it a GitHub source zip?"
        rm -rf "$extract_dir"
        exit 1
    fi

    log INFO "Syncing $source_root into $INSTALL_DIR (env files and uploads are preserved)"
    if $DRY_RUN; then
        log INFO "[dry-run] rsync -a --delete --exclude=.git --exclude=.env --exclude=backend/.env --exclude=backend/uploads --exclude=node_modules '$source_root/' '$INSTALL_DIR/'"
    else
        rsync -a --delete \
            --exclude=.git \
            --exclude=.env \
            --exclude=backend/.env \
            --exclude=backend/uploads \
            --exclude=node_modules \
            "$source_root/" "$INSTALL_DIR/"
    fi

    rm -rf "$extract_dir"
}

if [[ -n "$ZIP_URL" ]]; then
    log INFO "Downloading zip from $ZIP_URL"
    ZIP_PATH="$(mktemp --suffix=.zip)"
    run curl -fsSL "$ZIP_URL" -o "$ZIP_PATH"
fi

if [[ -n "$ZIP_PATH" ]]; then
    update_via_zip "$ZIP_PATH"
else
    update_via_git
fi

cd "$INSTALL_DIR"

if [[ -f docker-compose.yml || -f docker-compose.yaml || -f compose.yml || -f compose.yaml ]]; then
    log INFO "Rebuilding and restarting via 'docker compose up -d --build'"
    run docker compose up -d --build
    log OK "Update finished. Check status with: docker compose ps"
elif [[ -f /etc/systemd/system/nisorga.service ]]; then
    log INFO "Node.js deployment detected (systemd service 'nisorga'). Reinstalling dependencies and rebuilding."
    if [[ -f package-lock.json ]]; then run npm ci; else run npm install; fi
    if npm run 2>/dev/null | grep -q '^  build'; then run npm run build; fi
    run systemctl restart nisorga
    log OK "Update finished. Check status with: systemctl status nisorga"
else
    log WARN "No recognized running deployment (docker-compose.yml or systemd service 'nisorga') found in $INSTALL_DIR."
    log WARN "Code was updated, but nothing was rebuilt/restarted automatically."
fi
