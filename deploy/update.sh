#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/wujianfengyun"
BRANCH="main"
PORT="8787"
DOMAIN=""
HTTPS_MODE="reserved"
RUN_TESTS="1"
SERVICE_NAME="wujianfengyun-server"
ALLOW_DIRTY="0"

log() { printf '\n[deploy] %s\n' "$*"; }
warn() { printf '\n[deploy][WARN] %s\n' "$*" >&2; }
fail() { printf '\n[deploy][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash deploy/update.sh [options]

Options:
  --domain <value>       Domain or server IP. If provided, client/.env.production is refreshed.
  --project-dir <path>   Deploy directory. Default: /opt/wujianfengyun
  --branch <name>        Git branch. Default: main
  --port <number>        Backend WebSocket port. Default: 8787
  --https <mode>         reserved | enabled | off. Default: reserved
  --skip-tests           Skip npm test during deployment.
  --allow-dirty          Allow updating even when working tree has local modifications.
  -h, --help             Show this help.

Examples:
  bash deploy/update.sh --domain game.example.com
  bash deploy/update.sh --domain 1.2.3.4 --https off
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --project-dir) PROJECT_DIR="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --https) HTTPS_MODE="${2:-}"; shift 2 ;;
    --skip-tests) RUN_TESTS="0"; shift ;;
    --allow-dirty) ALLOW_DIRTY="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -n "$PROJECT_DIR" && "$PROJECT_DIR" != "/" ]] || fail "Unsafe --project-dir: $PROJECT_DIR"
[[ "$HTTPS_MODE" == "reserved" || "$HTTPS_MODE" == "enabled" || "$HTTPS_MODE" == "off" ]] || fail "--https must be reserved, enabled, or off."
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "--port must be a number."
[[ -d "$PROJECT_DIR/.git" ]] || fail "$PROJECT_DIR is not a Git repository. Run deploy/install.sh first."

cd "$PROJECT_DIR"

if [[ "$ALLOW_DIRTY" != "1" && -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "Working tree has local modifications. Commit/stash them, or rerun with --allow-dirty if you know what you are doing."
fi

log "Checking sudo access"
sudo -v

log "Current commit: $(git rev-parse --short HEAD)"
log "Pulling latest code from branch: $BRANCH"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
log "Updated commit: $(git rev-parse --short HEAD)"

if [[ -n "$DOMAIN" ]]; then
  IS_IP="0"
  if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    IS_IP="1"
  fi

  if [[ "$HTTPS_MODE" == "enabled" && "$IS_IP" == "1" ]]; then
    fail "--https enabled requires a real domain, not an IP address. Use --https off for IP testing."
  fi

  if [[ "$HTTPS_MODE" == "off" || "$IS_IP" == "1" ]]; then
    WS_URL="ws://${DOMAIN}/ws"
  else
    WS_URL="wss://${DOMAIN}/ws"
  fi

  log "Refreshing client production WebSocket URL: $WS_URL"
  cat > client/.env.production <<EOF
VITE_WS_URL=${WS_URL}
EOF
elif [[ -f client/.env.production ]]; then
  log "Keeping existing client/.env.production"
else
  warn "No --domain provided and client/.env.production does not exist. The client will use its built-in fallback."
fi

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

log "Validating Nginx config before reload"
sudo nginx -t

log "Restarting services"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

log "Update complete"
sudo systemctl status "$SERVICE_NAME" --no-pager -l || true
printf '\nUseful checks:\n'
printf '  ss -lntp | grep -E "(:80|:443|:%s)"\n' "$PORT"
printf '  sudo journalctl -u %s -n 100 --no-pager -l\n' "$SERVICE_NAME"
