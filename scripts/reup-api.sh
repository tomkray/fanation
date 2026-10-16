#!/usr/bin/env bash
# Restart only the city API (loads Muse → auto avatar refresh).
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f 'tsx src/infrastructure/http/main.ts' 2>/dev/null || true
pid=$(lsof -nP -tiTCP:8787 -sTCP:LISTEN || true)
if [ -n "${pid:-}" ]; then kill -9 $pid 2>/dev/null || true; fi
sleep 1
FANATION_DEMO=0 FANATION_COMMENT_SOURCE=off HOST=127.0.0.1 PORT=8787 \
  npx tsx src/infrastructure/http/main.ts
