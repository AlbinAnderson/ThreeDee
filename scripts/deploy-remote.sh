#!/usr/bin/env bash
# Install a release on the droplet. Run by the Deploy workflow over SSH:
#
#   deploy-remote.sh <release-id> <path to release .tgz>
#
# Layout:  $APP_DIR/releases/<id>/   one directory per deployed commit
#          $APP_DIR/current          symlink to the live release (the service runs from here)
#
# Steps: unpack, install production dependencies, back up the database with the
# *old* release, switch the symlink, restart, health-check. If the new release
# doesn't come up healthy, switch back and restart the old one. Keeps the last
# $KEEP releases for quick rollback.
#
# Everything is overridable through the environment, which is also how the
# script is tested locally without systemd.
set -euo pipefail

RELEASE_ID="${1:?release id}"
TARBALL="${2:?path to release tarball}"
APP_DIR="${APP_DIR:-/opt/tabletop}"
DATA_DIR="${DATA_DIR:-/var/lib/tabletop}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
KEEP="${KEEP:-5}"
# How to run commands as the service user, and how to restart the service.
# (AS_SERVICE may be set to empty to run as the current user, e.g. in tests.)
AS_SERVICE="${AS_SERVICE-sudo -n -u tabletop}"
RESTART_CMD="${RESTART_CMD:-sudo -n systemctl restart tabletop}"

log() { printf '[deploy] %s\n' "$*"; }

# A fresh directory per deploy, so redeploying the live commit never touches the running files.
release="$APP_DIR/releases/${RELEASE_ID:0:12}-$(date +%Y%m%d%H%M%S)"
current="$APP_DIR/current"
previous="$(readlink -f "$current" 2>/dev/null || true)"

# If anything fails before the switch, drop the half-installed release; the live one is untouched.
switched=0
cleanup() {
  rm -f "$TARBALL"
  if [ "$switched" = 0 ]; then rm -rf "$release"; fi
}
trap cleanup EXIT

log "unpacking into $release"
mkdir -p "$release"
tar -xzf "$TARBALL" -C "$release"

log "installing production dependencies"
(cd "$release" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

if [ -n "$previous" ] && [ -f "$previous/packages/server/src/cli.ts" ]; then
  log "backing up the database before switching"
  (cd "$previous/packages/server" && $AS_SERVICE env DATA_DIR="$DATA_DIR" node --import tsx src/cli.ts backup)
else
  log "first deploy: nothing to back up"
fi

switch_to() {
  ln -sfn "$1" "$APP_DIR/current.next"
  mv -Tf "$APP_DIR/current.next" "$current"
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

log "switching to $RELEASE_ID and restarting"
switch_to "$release"
switched=1
$RESTART_CMD

if healthy; then
  log "healthy: $HEALTH_URL"
else
  log "NOT healthy after 30 s"
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    log "rolling back to $(basename "$previous")"
    switch_to "$previous"
    $RESTART_CMD
    healthy && log "previous release is back up" || log "previous release is not healthy either; check: journalctl -u tabletop -n 100"
  fi
  exit 1
fi

log "pruning old releases (keeping $KEEP)"
live="$(readlink -f "$current")"
ls -1dt "$APP_DIR"/releases/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$(readlink -f "$old")" = "$live" ] || rm -rf "$old"
done
rm -f "$TARBALL"
log "done: $RELEASE_ID is live"
