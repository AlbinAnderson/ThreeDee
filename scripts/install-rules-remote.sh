#!/usr/bin/env bash
# Atomically install a built PF1e rules pack archive on the droplet and restart
# the service. Run by the Sync Rules Pack workflow or `scripts/sync-rules.sh`:
#
#   install-rules-remote.sh <path to rules-pack.tgz>
#
# Uses the same environment overrides as `deploy-remote.sh` so it can be tested
# locally without systemd.
set -euo pipefail

TARBALL="${1:?path to rules pack tarball}"
APP_DIR="${APP_DIR:-/opt/tabletop}"
DATA_DIR="${DATA_DIR:-/var/lib/tabletop}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
AS_SERVICE="${AS_SERVICE-sudo -n -u tabletop}"
RESTART_CMD="${RESTART_CMD:-sudo -n systemctl restart tabletop}"

log() { printf '[rules] %s\n' "$*"; }

cleanup() { rm -f "$TARBALL"; }
trap cleanup EXIT

current="$APP_DIR/current"
if [ ! -f "$current/packages/server/src/cli.ts" ]; then
  log "ERROR: no live release found at $current (deploy the app first)"
  exit 1
fi

# Make sure the service user can read the uploaded tarball in /tmp.
chmod 644 "$TARBALL"

log "validating and installing rules pack into $DATA_DIR/rules"
(cd "$current/packages/server" && $AS_SERVICE env DATA_DIR="$DATA_DIR" node --import tsx src/cli.ts rules install "$TARBALL")

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

log "restarting service to reload rules pack"
$RESTART_CMD

if healthy; then
  log "healthy: $HEALTH_URL"
else
  log "NOT healthy after 30 s; attempting rules pack rollback"
  (cd "$current/packages/server" && $AS_SERVICE env DATA_DIR="$DATA_DIR" node --import tsx src/cli.ts rules rollback) || true
  $RESTART_CMD
  healthy && log "previous rules pack is back up" || log "service still unhealthy; check: journalctl -u tabletop -n 100"
  exit 1
fi

log "done: rules pack updated"
