#!/usr/bin/env bash
# Off-disk copy of the city, as launchd runs it every 5 minutes
# (com.naoeumfa.backup). The book is checked with its own hash chain before it
# is copied: an edited book never replaces a good copy. Secrets (.env) are
# never copied.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

DEST="${NAOEUMFA_BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/naoeumfa-backups}"
KEEP=300
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LEDGER=data/ledger.jsonl

mkdir -p "$DEST/ledger" "$DEST/latest"

if [ ! -s "$LEDGER" ]; then
  echo "$STAMP ledger empty; nothing to copy"
  exit 0
fi

if ! verify=$(npx tsx scripts/ledger-verify.ts "$LEDGER" 2>&1); then
  echo "$STAMP REFUSED: the book failed its hash check; last good copy kept"
  echo "$verify"
  exit 1
fi

sum=$(shasum -a 256 "$LEDGER" | cut -d' ' -f1)
last=$(cat "$DEST/latest/ledger.sha256" 2>/dev/null || true)
if [ "$sum" != "$last" ]; then
  cp "$LEDGER" "$DEST/ledger/ledger-$STAMP.jsonl"
  cp "$LEDGER" "$DEST/latest/ledger.jsonl"
  echo "$sum" > "$DEST/latest/ledger.sha256"
  echo "$verify" > "$DEST/latest/HEAD.txt"
  echo "$STAMP copied book ($sum)"
fi

# Who signed in and which account owns which profile: small, needed to restore.
for f in data/sessions.json data/identities.json data/ads.json; do
  [ -f "$f" ] && cp "$f" "$DEST/latest/"
done
rsync -a --delete data/avatars/ "$DEST/latest/avatars/"

# Keep the newest snapshots only; the book is append-only, so the newest holds everything.
ls -1t "$DEST/ledger"/ledger-*.jsonl 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
exit 0
