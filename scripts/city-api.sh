#!/usr/bin/env bash
# The live city API, as launchd runs it (com.naoeumfa.api). Real fans only:
# the live journal, no demo, comments arrive through Muse or Meta.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NAOEUMFA_JOURNAL_PATH="data/ledger.jsonl"
export NAOEUMFA_DEMO=0
export NAOEUMFA_COMMENT_SOURCE="${NAOEUMFA_COMMENT_SOURCE:-off}"
export HOST=127.0.0.1
export PORT=8787
exec npx tsx src/infrastructure/http/main.ts
