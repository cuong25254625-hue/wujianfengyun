#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/wujianfengyun"
PORT="8787"
SERVICE_NAME="wujianfengyun-server"

usage() {
  cat <<'EOF'
Usage: bash deploy/status.sh [options]

Options:
  --project-dir <path>   Deploy directory. Default: /opt/wujianfengyun
  --port <number>        Backend WebSocket port. Default: 8787
  -h, --help             Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '[deploy][ERROR] Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

section() { printf '\n========== %s ==========' "$1"; printf '\n'; }
run() {
  printf '\n$ %s\n' "$*"
  "$@" || true
}

section "System"
run lsb_release -a
run node -v
run npm -v

section "Project"
printf 'PROJECT_DIR=%s\n' "$PROJECT_DIR"
if [[ -d "$PROJECT_DIR/.git" ]]; then
  run git -C "$PROJECT_DIR" status --short
  run git -C "$PROJECT_DIR" log -1 --oneline
else
  printf 'Git repository not found at %s\n' "$PROJECT_DIR"
fi

section "Build artifacts"
for file in \
  "$PROJECT_DIR/client/dist/index.html" \
  "$PROJECT_DIR/server/dist/index.js" \
  "$PROJECT_DIR/shared/dist/index.js" \
  "$PROJECT_DIR/client/.env.production"; do
  if [[ -e "$file" ]]; then
    printf '[OK] %s\n' "$file"
  else
    printf '[MISS] %s\n' "$file"
  fi
done

section "systemd service"
run systemctl is-enabled "$SERVICE_NAME"
run systemctl is-active "$SERVICE_NAME"
run systemctl status "$SERVICE_NAME" --no-pager -l

section "Nginx"
run sudo nginx -t
run systemctl is-active nginx
run ls -la /etc/nginx/sites-enabled/

section "Ports"
printf '\n$ ss -lntp | grep -E "(:80|:443|:%s)"\n' "$PORT"
ss -lntp | grep -E "(:80|:443|:${PORT})" || true

section "Recent backend logs"
run sudo journalctl -u "$SERVICE_NAME" -n 80 --no-pager -l

section "Recent nginx logs"
run sudo journalctl -u nginx -n 40 --no-pager -l
