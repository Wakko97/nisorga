#!/usr/bin/env bash
#
# nisorga-app-install.sh
#
# Runs INSIDE the LXC container (Debian/Ubuntu). Clones the Nisorga
# application repository and installs it, auto-detecting the stack
# (Docker Compose, Node.js, or Python) from what it finds in the repo.
#
# Not meant to be run manually on the Proxmox host - it is pushed into
# the container and executed by nisorga-lxc-install.sh. It can also be
# run directly inside an existing container/VM if needed:
#
#   sudo ./nisorga-app-install.sh [options]
#
# Options:
#   --repo <url>        Git repository URL (default: https://github.com/Wakko97/nisorga.git)
#   --branch <name>      Git branch to check out (default: main)
#   --dir <path>           Install directory (default: /opt/nisorga)
#   -h, --help                Show this help text

set -euo pipefail

REPO_URL="https://github.com/Wakko97/nisorga.git"
BRANCH="main"
INSTALL_DIR="/opt/nisorga"

COLOR_RESET="\e[0m"; COLOR_BLUE="\e[34m"; COLOR_GREEN="\e[32m"; COLOR_YELLOW="\e[33m"; COLOR_RED="\e[31m"
log() {
    local level="$1"; shift
    local color="$COLOR_RESET"
    case "$level" in INFO) color="$COLOR_BLUE";; OK) color="$COLOR_GREEN";; WARN) color="$COLOR_YELLOW";; ERROR) color="$COLOR_RED";; esac
    echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*${COLOR_RESET}"
}

print_help() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO_URL="${2:-}"; shift ;;
        --branch) BRANCH="${2:-}"; shift ;;
        --dir) INSTALL_DIR="${2:-}"; shift ;;
        -h|--help) print_help; exit 0 ;;
        *) log ERROR "Unknown option: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [[ "$(id -u)" -ne 0 ]]; then
    log ERROR "This script must be run as root."
    exit 1
fi

log INFO "Installing base dependencies (git, curl, ca-certificates)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends git curl ca-certificates gnupg sudo lsb-release

if [[ -d "$INSTALL_DIR/.git" ]]; then
    log INFO "Repository already present at $INSTALL_DIR, updating."
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
    log INFO "Cloning $REPO_URL (branch: $BRANCH) into $INSTALL_DIR"
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

install_docker() {
    if command -v docker >/dev/null 2>&1; then
        log OK "Docker already installed."
        return
    fi
    log INFO "Installing Docker Engine"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
}

prepare_compose_env_files() {
    if [[ ! -f .env && -f .env.example ]]; then
        log INFO "Creating .env from .env.example (generating a random Postgres password)"
        cp .env.example .env
        sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
    fi

    if [[ ! -f backend/.env && -f backend/.env.example ]]; then
        log INFO "Creating backend/.env from backend/.env.example (generating random secrets)"
        cp backend/.env.example backend/.env

        local pg_user pg_pass pg_db
        pg_user="$(grep -oP '^POSTGRES_USER=\K.*' .env 2>/dev/null || echo nisorga)"
        pg_pass="$(grep -oP '^POSTGRES_PASSWORD=\K.*' .env 2>/dev/null || echo change-me)"
        pg_db="$(grep -oP '^POSTGRES_DB=\K.*' .env 2>/dev/null || echo nisorga)"

        # docker-compose runs the backend against the "postgres" service, not localhost.
        sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://${pg_user}:${pg_pass}@postgres:5432/${pg_db}?schema=public\"#" backend/.env
        sed -i "s#^JWT_SECRET=.*#JWT_SECRET=\"$(openssl rand -hex 32)\"#" backend/.env
        sed -i "s#^GOOGLE_TOKEN_ENCRYPTION_KEY=.*#GOOGLE_TOKEN_ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"#" backend/.env
        sed -i "s#^EMAIL_INBOUND_SECRET=.*#EMAIL_INBOUND_SECRET=\"$(openssl rand -hex 16)\"#" backend/.env

        log WARN "backend/.env was created with generated secrets. Google Calendar and SendGrid are left unconfigured (GOOGLE_CLIENT_ID/SECRET, SENDGRID_API_KEY) - fill them in manually if needed, then 'docker compose restart backend'."
    fi
}

setup_docker_compose() {
    log INFO "Detected Docker Compose project."
    install_docker
    prepare_compose_env_files
    log INFO "Starting application with 'docker compose up -d --build'"
    docker compose up -d --build
    systemctl enable docker >/dev/null 2>&1 || true
    log OK "Nisorga is running via Docker Compose. Check status with: docker compose -f $INSTALL_DIR/docker-compose.yml ps"
    log WARN "No host port is published by default (see docker-compose.yml, service 'frontend') - the app is reachable only from inside the container/network until a reverse proxy or a 'ports:' mapping is added."
}

setup_nodejs() {
    log INFO "Detected Node.js project (package.json)."
    if ! command -v node >/dev/null 2>&1; then
        log INFO "Installing Node.js LTS"
        curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
        apt-get install -y nodejs
    fi

    if [[ -f package-lock.json ]]; then
        npm ci
    else
        npm install
    fi

    if npm run | grep -q '^  build'; then
        log INFO "Running 'npm run build'"
        npm run build
    fi

    local start_cmd="npm start"
    if ! npm run | grep -q '^  start'; then
        start_cmd="node index.js"
        log WARN "No 'start' script found in package.json - defaulting the service to '$start_cmd'. Adjust /etc/systemd/system/nisorga.service if needed."
    fi

    cat > /etc/systemd/system/nisorga.service <<EOF
[Unit]
Description=Nisorga Application
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/env $start_cmd
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now nisorga.service
    log OK "Nisorga installed as systemd service 'nisorga'. Check status with: systemctl status nisorga"
}

setup_python() {
    log INFO "Detected Python project."
    apt-get install -y python3 python3-venv python3-pip
    python3 -m venv "$INSTALL_DIR/.venv"
    source "$INSTALL_DIR/.venv/bin/activate"
    if [[ -f requirements.txt ]]; then
        pip install --upgrade pip
        pip install -r requirements.txt
    elif [[ -f pyproject.toml ]]; then
        pip install --upgrade pip
        pip install .
    fi
    deactivate
    log WARN "Python dependencies installed into $INSTALL_DIR/.venv, but the application entry point is unknown."
    log WARN "Create /etc/systemd/system/nisorga.service manually, e.g. with ExecStart=$INSTALL_DIR/.venv/bin/python $INSTALL_DIR/<entrypoint>.py"
}

if [[ -f docker-compose.yml || -f docker-compose.yaml || -f compose.yml || -f compose.yaml ]]; then
    setup_docker_compose
elif [[ -f package.json ]]; then
    setup_nodejs
elif [[ -f requirements.txt || -f pyproject.toml ]]; then
    setup_python
elif [[ -f Dockerfile ]]; then
    log INFO "Detected a standalone Dockerfile."
    install_docker
    docker build -t nisorga:latest .
    log WARN "Image 'nisorga:latest' built. No exposed port is known yet - start it manually, e.g.:"
    log WARN "  docker run -d --name nisorga --restart unless-stopped -p 8080:8080 nisorga:latest"
else
    log WARN "No recognizable application stack (docker-compose.yml, package.json, requirements.txt, Dockerfile) found in the repository yet."
    log WARN "The repository has been cloned to $INSTALL_DIR. Re-run this script once the Nisorga application code has been added."
fi

log OK "nisorga-app-install.sh finished."
