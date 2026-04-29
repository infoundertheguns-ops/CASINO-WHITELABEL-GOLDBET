#!/usr/bin/env bash
# scripts/deploy/remote-apply.sh
# SSH'd from CI, runs ON THE TARGET VPS.
# Args: <target-dir> <service-name> <env-file-path> <health-url>
#
# Performs: stop -> backup .next -> extract -> npm ci -> start -> health check -> rollback if needed.

set -euo pipefail

# Source NVM if present (scraper-vps uses NVM, staging uses system Node)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
# Fallback PATH for common Node install locations
export PATH="/usr/local/bin:/usr/bin:$PATH"
command -v node >/dev/null || { echo "FATAL: node not in PATH ($PATH)"; exit 1; }
command -v npm >/dev/null || { echo "FATAL: npm not in PATH ($PATH)"; exit 1; }
echo "Using node $(node --version) at $(which node)"

TARGET_DIR="$1"
SERVICE="$2"
ENV_FILE="$3"
HEALTH_URL="$4"

cd "$TARGET_DIR"

echo "[1/6] Stopping $SERVICE..."
systemctl stop "$SERVICE" || true

echo "[2/6] Backing up previous .next..."
rm -rf /tmp/rollback-prev
[ -d .next ] && mv .next /tmp/rollback-prev

echo "[3/6] Extracting new build..."
tar xzf /tmp/deploy-source.tar.gz
tar xzf /tmp/deploy-next.tar.gz
[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE missing"; exit 1; }

echo "[4/6] Installing prod deps..."
npm ci --omit=dev 2>&1 | tail -5

echo "[5/6] Starting $SERVICE..."
systemctl start "$SERVICE"
sleep 8

echo "[6/6] Health check..."
for i in 1 2 3; do
  CODE=$(curl -s -o /tmp/health-body -w "%{http_code}" --max-time 5 "$HEALTH_URL" || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "OK -- health check passed"
    cat /tmp/health-body
    exit 0
  fi
  echo "  attempt $i: HTTP $CODE"
  sleep 5
done

echo "FATAL: health check failed after 3 attempts. Rolling back..."
systemctl stop "$SERVICE"
rm -rf .next
[ -d /tmp/rollback-prev ] && mv /tmp/rollback-prev .next
systemctl start "$SERVICE"
sleep 5
curl -s "$HEALTH_URL" || true
exit 1
