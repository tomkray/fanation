#!/usr/bin/env bash
# Off-disk copy of the city, as launchd runs it every 5 minutes
# (com.naoeumfa.backup). The book is checked with its own hash chain before it
# is copied: an edited book is never copied over a good one. Secrets (.env) are
# never copied.
#
# Every copy is a new folder (snapshots/<UTC stamp>/). macOS lets a background
# job create files in iCloud Drive but not overwrite files another app made, so
# nothing here is ever overwritten.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

DEST="${NAOEUMFA_BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/naoeumfa-backups}"
STATE="${NAOEUMFA_BACKUP_STATE:-$HOME/.naoeumfa-backup.sha256}"
KEEP=300
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LEDGER=data/ledger.jsonl

if [ ! -s "$LEDGER" ]; then
  echo "$STAMP ledger empty; nothing to copy"
  exit 0
fi

if ! verify=$(npx tsx scripts/ledger-verify.ts "$LEDGER" 2>&1); then
  echo "$STAMP REFUSED: the book failed its hash check; last good copy kept"
  echo "$verify"
  exit 1
fi

# Only the book decides whether a new copy is needed; sessions ride along.
sum=$(cat "$LEDGER" data/sessions.json data/identities.json 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
if [ "$sum" = "$(cat "$STATE" 2>/dev/null || true)" ]; then
  exit 0
fi

SNAP="$DEST/snapshots/$STAMP"
if ! mkdir -p "$SNAP" || ! cp "$LEDGER" "$SNAP/ledger.jsonl"; then
  echo "$STAMP FAILED: could not write $SNAP"
  exit 1
fi
echo "$verify" | grep -v 'npm warn' > "$SNAP/HEAD.txt"
# Who signed in and which account owns which profile: small, needed to restore.
# Profile pictures are not copied: `npm run avatar:sync` fetches them again.
for f in data/sessions.json data/identities.json data/ads.json; do
  [ -f "$f" ] && cp "$f" "$SNAP/"
done
echo "$sum" > "$STATE"
echo "$STAMP copied book to $SNAP"

# Keep the newest snapshots only; the book is append-only, so the newest holds everything.
ls -1d "$DEST/snapshots"/*/ 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -rf "$old"; done
exit 0
