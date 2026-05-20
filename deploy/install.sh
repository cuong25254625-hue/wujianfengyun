#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/cuong25254625-hue/wujianfengyun.git"
PROJECT_DIR="/opt/wujianfengyun"
BRANCH="main"
PORT="8787"
DOMAIN=""
HTTPS_MODE="reserved"
RUN_TESTS="1"
SERVICE_NAME="wujianfengyun-server"
SERVICE_USER="www-data"
SERVICE_GROUP="www-data"

log() { printf '\n[deploy] %s\n' "$*"; }
warn() { printf '\n[deploy][WARN] %s\n' "$*" >&2; }
fail() { printf '\n[deploy][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash deploy/install.sh --domain <domain-or-ip> [options]

Options:
  --domain <value>       Nginx server_name and public access host. Required.
  --repo <url>           Git repository URL. Default: https://github.com/cuong25254625-hue/wujianfengyun.git
  --project-dir <path>   Deploy directory. Default: /opt/wujianfengyun
  --branch <name>        Git branch. Default: main
  --port <number>        Backend WebSocket port. Default: 8787
  --https <mode>         reserved | enabled | off. Default: reserved
  --skip-tests           Skip npm test during deployment.
  -h, --help             Show this help.

Examples:
  bash deploy/install.sh --domain 1.2.3.4 --https off
  bash deploy/install.sh --domain game.example.com
  bash deploy/install.sh --domain game.example.com --https enabled
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --project-dir) PROJECT_DIR="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --https) HTTPS_MODE="${2:-}"; shift 2 ;;
    --skip-tests) RUN_TESTS="0"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -n "$DOMAIN" ]] || { usage; fail "--domain is required. You may pass a domain or server IP."; }
[[ -n "$PROJECT_DIR" && "$PROJECT_DIR" != "/" ]] || fail "Unsafe --project-dir: $PROJECT_DIR"
[[ "$HTTPS_MODE" == "reserved" || "$HTTPS_MODE" == "enabled" || "$HTTPS_MODE" == "off" ]] || fail "--https must be reserved, enabled, or off."
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "--port must be a number."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
    warn "This script is optimized for Ubuntu 22.04. Current system: ${PRETTY_NAME:-unknown}."
  fi
fi

IS_IP="0"
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_IP="1"
fi

if [[ "$HTTPS_MODE" == "enabled" && "$IS_IP" == "1" ]]; then
  fail "--https enabled requires a real domain, not an IP address. Use --https off for IP testing."
fi

if [[ "$HTTPS_MODE" == "off" || "$IS_IP" == "1" ]]; then
  WS_URL="ws://${DOMAIN}/ws"
  SITE_URL="http://${DOMAIN}/"
else
  WS_URL="wss://${DOMAIN}/ws"
  SITE_URL="https://${DOMAIN}/"
fi

log "Checking sudo access"
sudo -v

log "Installing system dependencies"
sudo apt update
sudo apt install -y curl git nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null || true)" != v20.* ]]; then
  log "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  log "Node.js already installed: $(node -v)"
fi

log "Preparing project directory: $PROJECT_DIR"
if [[ ! -e "$PROJECT_DIR" ]]; then
  sudo mkdir -p "$(dirname "$PROJECT_DIR")"
  sudo chown "$USER:$USER" "$(dirname "$PROJECT_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
elif [[ -d "$PROJECT_DIR/.git" ]]; then
  log "Existing Git repository found, updating with fast-forward only"
  git -C "$PROJECT_DIR" fetch --all --prune
  git -C "$PROJECT_DIR" checkout "$BRANCH"
  git -C "$PROJECT_DIR" pull --ff-only origin "$BRANCH"
else
  fail "$PROJECT_DIR exists but is not a Git repository. Move it away or choose another --project-dir."
fi

cd "$PROJECT_DIR"

log "Writing client production WebSocket URL: $WS_URL"
cat > client/.env.production <<EOF
VITE_WS_URL=${WS_URL}
EOF

log "Installing npm dependencies"
npm ci

log "Running typecheck"
npm run typecheck

if [[ "$RUN_TESTS" == "1" ]]; then
  log "Running tests"
  npm test
else
  warn "Skipping tests because --skip-tests was provided."
fi

log "Building application"
npm run build

log "Installing systemd service: $SERVICE_NAME"
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=Wujian Fengyun MVP WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
ExecStart=/usr/bin/node ${PROJECT_DIR}/server/dist/index.js
Restart=always
RestartSec=3
User=${SERVICE_USER}
Group=${SERVICE_GROUP}

[Install]
WantedBy=multi-user.target
EOF

sudo chmod -R a+rX "$PROJECT_DIR"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

log "Installing Nginx site"
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/sites-available/wujianfengyun > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root ${PROJECT_DIR}/client/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /ws {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/wujianfengyun /etc/nginx/sites-enabled/wujianfengyun
sudo nginx -t
sudo systemctl reload nginx

if [[ "$HTTPS_MODE" == "enabled" ]]; then
  log "Requesting HTTPS certificate with Certbot"
  sudo apt install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d "$DOMAIN"
  sudo nginx -t
  sudo systemctl reload nginx
elif [[ "$HTTPS_MODE" == "reserved" && "$IS_IP" == "0" ]]; then
  log "HTTPS is reserved but not enabled yet. When DNS is ready, run:"
  printf '  sudo apt install -y certbot python3-certbot-nginx\n'
  printf '  sudo certbot --nginx -d %s\n' "$DOMAIN"
fi

log "Deployment complete"
printf 'Site URL: %s\n' "$SITE_URL"
printf 'Frontend WebSocket URL baked into client: %s\n' "$WS_URL"
printf '\nUseful commands:\n'
printf '  sudo systemctl status %s --no-pager -l\n' "$SERVICE_NAME"
printf '  sudo journalctl -u %s -f\n' "$SERVICE_NAME"
printf '  bash %s/deploy/status.sh --project-dir %s\n' "$PROJECT_DIR" "$PROJECT_DIR"
printf '  bash %s/deploy/update.sh --domain %s --project-dir %s\n' "$PROJECT_DIR" "$DOMAIN" "$PROJECT_DIR"
