#!/usr/bin/env bash
#
# nisorga-backup.sh
#
# Creates (or restores) a backup of a Nisorga installation running via
# Docker Compose: a Postgres dump plus backend/uploads/ (item attachments),
# bundled into a single tar.gz. Runs INSIDE the container set up by
# nisorga-app-install.sh / nisorga-lxc-install.sh. Can also be pulled onto
# the Proxmox host by nisorga-lxc-backup.sh, so the backup survives the
# container being lost too.
#
# Usage:
#   ./nisorga-backup.sh [options]
#   ./nisorga-backup.sh --restore <backup.tar.gz> [options]
#
# Options:
#   --install-dir <path>   Nisorga install dir (default: /opt/nisorga)
#   --dir <path>              Directory backups are written to (default:
#                                <install-dir>/backups)
#   --keep <n>                  How many backups to retain, oldest deleted
#                                  first (default: 7; 0 = keep all)
#   --restore <file>               Restore from a backup archive instead of
#                                     creating one. DESTRUCTIVE: replaces the
#                                     current database and uploads.
#   --yes, -y                         Skip the restore confirmation prompt
#   --dry-run                            Print what would be done without
#                                           changing anything
#   -h, --help                              Show this help text

set -euo pipefail

INSTALL_DIR="/opt/nisorga"
BACKUP_DIR=""
KEEP=7
RESTORE_FILE=""
ASSUME_YES=false
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

confirm() {
    local prompt="$1"
    $ASSUME_YES && return 0
    read -r -p "$prompt [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

print_help() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install-dir) INSTALL_DIR="${2:-}"; shift ;;
        --dir) BACKUP_DIR="${2:-}"; shift ;;
        --keep) KEEP="${2:-}"; shift ;;
        --restore) RESTORE_FILE="${2:-}"; shift ;;
        --yes|-y) ASSUME_YES=true ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

[[ -n "$BACKUP_DIR" ]] || BACKUP_DIR="$INSTALL_DIR/backups"

if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    log ERROR "$INSTALL_DIR/docker-compose.yml not found - this script expects a Docker Compose install (see nisorga-app-install.sh)."
    exit 1
fi
cd "$INSTALL_DIR"

pg_user="$(grep -oP '^POSTGRES_USER=\K.*' .env 2>/dev/null || echo nisorga)"
pg_db="$(grep -oP '^POSTGRES_DB=\K.*' .env 2>/dev/null || echo nisorga)"

create_backup() {
    run mkdir -p "$BACKUP_DIR"

    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT

    log INFO "Dumping Postgres database '$pg_db'"
    if $DRY_RUN; then
        log INFO "[dry-run] docker compose exec -T postgres pg_dump -U '$pg_user' --clean --if-exists '$pg_db' | gzip > '$tmp/db.sql.gz'"
    else
        docker compose exec -T postgres pg_dump -U "$pg_user" --clean --if-exists "$pg_db" | gzip > "$tmp/db.sql.gz"
    fi

    log INFO "Archiving backend/uploads/"
    if $DRY_RUN; then
        log INFO "[dry-run] docker compose exec -T backend tar -czf - -C /app uploads > '$tmp/uploads.tar.gz'"
    else
        docker compose exec -T backend tar -czf - -C /app uploads > "$tmp/uploads.tar.gz"
    fi

    local backup_file="$BACKUP_DIR/nisorga-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    log INFO "Writing $backup_file"
    if $DRY_RUN; then
        log INFO "[dry-run] tar -C '$tmp' -czf '$backup_file' db.sql.gz uploads.tar.gz"
    else
        tar -C "$tmp" -czf "$backup_file" db.sql.gz uploads.tar.gz
        log OK "Backup written: $backup_file ($(du -h "$backup_file" | cut -f1))"
    fi

    if [[ "$KEEP" -gt 0 ]]; then
        local old
        # List oldest-first, drop the $KEEP newest, delete the rest.
        while IFS= read -r old; do
            log INFO "Removing old backup: $old"
            run rm -f "$old"
        done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'nisorga-backup-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
            | sort -n | cut -d' ' -f2- | head -n -"$KEEP")
    fi
}

restore_backup() {
    local archive="$1"
    [[ -f "$archive" ]] || { log ERROR "Backup file not found: $archive"; exit 1; }

    log WARN "This will REPLACE the current database and all uploaded attachments in $INSTALL_DIR with the contents of $archive."
    confirm "Proceed with restore?" || { log WARN "Aborted."; exit 0; }

    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT

    log INFO "Extracting $archive"
    run tar -C "$tmp" -xzf "$archive"

    if $DRY_RUN; then
        log INFO "[dry-run] would restore database from $tmp/db.sql.gz"
    else
        log INFO "Restoring database '$pg_db'"
        gunzip -c "$tmp/db.sql.gz" | docker compose exec -T postgres psql -U "$pg_user" -d "$pg_db"
    fi

    if $DRY_RUN; then
        log INFO "[dry-run] would restore uploads from $tmp/uploads.tar.gz"
    else
        log INFO "Restoring backend/uploads/"
        docker compose exec -T backend sh -c 'rm -rf /app/uploads && mkdir -p /app/uploads'
        gunzip -c "$tmp/uploads.tar.gz" | docker compose exec -T backend tar -xzf - -C /app
    fi

    log INFO "Restarting backend to pick up the restored database"
    run docker compose restart backend

    log OK "Restore finished."
}

if [[ -n "$RESTORE_FILE" ]]; then
    restore_backup "$RESTORE_FILE"
else
    create_backup
fi
