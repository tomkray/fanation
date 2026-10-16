#!/usr/bin/env bash
# Relight Não É Um Fã city API + Cloudflare quick tunnel after sleep/battery death.
# Run in Terminal.app (needs real DNS):  bash scripts/reup-public.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Always recycle the API so Muse avatar auto-refresh (current code) is loaded.
echo "recycling API on 8787…"
pkill -f 'tsx src/infrastructure/http/main.ts' 2>/dev/null || true
pid=$(lsof -nP -tiTCP:8787 -sTCP:LISTEN || true)
if [ -n "${pid:-}" ]; then kill -9 $pid 2>/dev/null || true; fi
sleep 1
NAOEUMFA_DEMO=0 NAOEUMFA_COMMENT_SOURCE=off HOST=127.0.0.1 PORT=8787 \
  npx tsx src/infrastructure/http/main.ts > /tmp/naoeumfa-api.log 2>&1 &
sleep 2
curl -sS -m 3 http://127.0.0.1:8787/api/v1/config | head -c 180
echo
rg -n 'avatars_' /tmp/naoeumfa-api.log | tail -n 3 || true

pkill -f 'cloudflared tunnel --url http://127.0.0.1:8787' 2>/dev/null || true
sleep 1
echo "starting cloudflared…"
cloudflared tunnel --url http://127.0.0.1:8787 2>&1 | tee /tmp/cloudflared-naoeumfa.log
