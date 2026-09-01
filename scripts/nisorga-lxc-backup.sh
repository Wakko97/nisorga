#!/usr/bin/env bash
#
# nisorga-lxc-backup.sh
#
# Run this script IN THE PROXMOX VE SHELL (as root on the Proxmox host) to
# back up (or restore) a Nisorga LXC container created by
# nisorga-lxc-install.sh. Pushes nisorga-backup.sh into the container, runs
# it there, and - for a backup - pulls the resulting archive back onto the
# Proxmox host, so the backup survives the container itself being lost
# (e.g. include the destination directory in the host's own vzdump/backup
# job).
#
# Usage:
#   ./nisorga-lxc-backup.sh --ctid <id> [options]
#   ./nisorga-lxc-backup.sh --ctid <id> --restore <local-file> [options]
#
# Options:
#   --ctid <id>            Container ID to back up/restore (required)
#   --dest <path>             Directory ON THE PROXMOX HOST backups are
#                               pulled into (default: /var/lib/vz/nisorga-backups/<ctid>)
#   --keep <n>                  How many backups to retain inside the
#                                  container (default: 7; 0 = keep all)
#   --restore <file>               Path ON THE PROXMOX HOST to a backup
#                                     archive to push into the container and
#                                     restore. DESTRUCTIVE.
#   --dir <path>                      Install directory inside the
#                                        container (default: /opt/nisorga)
#   --yes, -y                            Skip the restore confirmation prompt
#   --dry-run                               Print what would be done without
#                                              changing anything
#   -h, --help                                 Show this help text

set -euo pipefail

CTID=""
DEST=""
KEEP=7
RESTORE_FILE=""
INSTALL_DIR="/opt/nisorga"
ASSUME_YES=false
DRY_RUN=false

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/nisorga-backup.sh"
BACKUP_SCRIPT_URL="https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-backup.sh"

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
        --ctid) CTID="${2:-}"; shift ;;
        --dest) DEST="${2:-}"; shift ;;
        --keep) KEEP="${2:-}"; shift ;;
        --restore) RESTORE_FILE="${2:-}"; shift ;;
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        --yes|-y) ASSUME_YES=true ;;
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
[[ -n "$DEST" ]] || DEST="/var/lib/vz/nisorga-backups/$CTID"

if [[ -n "$RESTORE_FILE" && ! -f "$RESTORE_FILE" ]]; then
    log ERROR "Backup file not found on the Proxmox host: $RESTORE_FILE"
    exit 1
fi

if [[ "$(pct status "$CTID")" != "status: running" ]]; then
    log INFO "Container $CTID is not running, starting it."
    pct start "$CTID"
    sleep 2
fi

remote_script="/root/nisorga-backup.sh"
if [[ -f "$BACKUP_SCRIPT" ]]; then
    log INFO "Pushing nisorga-backup.sh into container $CTID"
    pct push "$CTID" "$BACKUP_SCRIPT" "$remote_script"
else
    log INFO "Local backup script not found, downloading it to the Proxmox host first"
    tmp_script="$(mktemp)"
    curl -fsSL "$BACKUP_SCRIPT_URL" -o "$tmp_script"
    pct push "$CTID" "$tmp_script" "$remote_script"
    rm -f "$tmp_script"
fi
pct exec "$CTID" -- chmod +x "$remote_script"

common_args=(--install-dir "$INSTALL_DIR")
$DRY_RUN && common_args+=(--dry-run)

if [[ -n "$RESTORE_FILE" ]]; then
    remote_backup="/root/nisorga-restore.tar.gz"
    log INFO "Pushing $RESTORE_FILE into container $CTID"
    pct push "$CTID" "$RESTORE_FILE" "$remote_backup"

    restore_args=("${common_args[@]}" --restore "$remote_backup")
    $ASSUME_YES && restore_args+=(--yes)

    log INFO "Running restore inside container $CTID"
    pct exec "$CTID" -- "$remote_script" "${restore_args[@]}"
    log OK "Restore of container $CTID finished."
else
    log INFO "Running backup inside container $CTID (keep=$KEEP)"
    pct exec "$CTID" -- "$remote_script" "${common_args[@]}" --keep "$KEEP"

    if $DRY_RUN; then
        log INFO "[dry-run] would pull the newly created backup into $DEST"
        exit 0
    fi

    latest="$(pct exec "$CTID" -- bash -c "ls -t '$INSTALL_DIR'/backups/nisorga-backup-*.tar.gz 2>/dev/null | head -n1")"
    if [[ -z "$latest" ]]; then
        log ERROR "Backup script ran but no backup archive was found inside the container."
        exit 1
    fi

    mkdir -p "$DEST"
    dest_file="$DEST/$(basename "$latest")"
    log INFO "Pulling $latest to $dest_file"
    pct pull "$CTID" "$latest" "$dest_file"
    log OK "Backup of container $CTID stored at $dest_file ($(du -h "$dest_file" | cut -f1)). Include $DEST in your own Proxmox backup/replication job for off-container safety."
fi
