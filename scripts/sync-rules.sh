#!/usr/bin/env bash
# Push the locally built `data/rules/` pack to the droplet over SSH and restart
# the service via `scripts/install-rules-remote.sh`.
#
# Usage:
#   ./scripts/sync-rules.sh <user@host> [port]
set -euo pipefail

TARGET="${1:?usage: sync-rules.sh <user@host> [port]}"
PORT="${2:-22}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULES_DIR="${RULES_DIR:-$REPO_ROOT/data/rules}"

for required in manifest.json class.json race.json; do
  if [ ! -f "$RULES_DIR/$required" ]; then
    echo "Missing $RULES_DIR/$required — build the rules pack first with: npm run vtt -- rules build <pcgen-dir>" >&2
    exit 1
  fi
done

STAMP="local-$(date +%Y%m%d%H%M%S)"
TMP_TGZ="$(mktemp "/tmp/rules-pack-${STAMP}-XXXXXX.tgz")"
cleanup() { rm -f "$TMP_TGZ"; }
trap cleanup EXIT

echo "[sync-rules] packing $RULES_DIR..."
tar -czf "$TMP_TGZ" -C "$RULES_DIR" .
ls -lh "$TMP_TGZ"

echo "[sync-rules] uploading to $TARGET..."
scp -P "$PORT" "$TMP_TGZ" "$TARGET:/tmp/rules-pack-${STAMP}.tgz"
scp -P "$PORT" "$REPO_ROOT/scripts/install-rules-remote.sh" "$TARGET:/tmp/install-rules-remote-${STAMP}.sh"

echo "[sync-rules] installing on $TARGET..."
ssh -p "$PORT" "$TARGET" \
  "trap 'rm -f /tmp/install-rules-remote-${STAMP}.sh' EXIT; bash /tmp/install-rules-remote-${STAMP}.sh /tmp/rules-pack-${STAMP}.tgz"
