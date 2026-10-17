#!/usr/bin/env bash
# Public door to the city, as launchd runs it (com.naoeumfa.tunnel).
#
# A Cloudflare quick tunnel gets a new hostname every time it starts. When
# that happens, this points the Vercel proxy at the new hostname (only
# api/proxy.ts and api/healthz.ts are committed) and pushes, so the site heals
# itself in about a minute instead of waiting for a human.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG=/tmp/naoeumfa-tunnel.log
FILES=(api/proxy.ts api/healthz.ts)
PUBLIC="${NAOEUMFA_PUBLIC_URL:-https://www.naoeumfa.com}"

: > "$LOG"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787 >>"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null' EXIT TERM INT

url=""
for _ in $(seq 1 60); do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -n 1 || true)
  [ -n "$url" ] && break
  sleep 1
done

if [ -z "$url" ]; then
  echo "$(date -u +%FT%TZ) no tunnel hostname after 60s" >>"$LOG"
else
  current=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' api/proxy.ts | head -n 1 || true)
  if [ "$url" != "$current" ]; then
    for f in "${FILES[@]}"; do
      sed -i '' -E "s#https://[a-z0-9-]+\.trycloudflare\.com#${url}#g" "$f"
    done
    if git commit -m "Point the Vercel proxy at the city's new tunnel." -- "${FILES[@]}" >>"$LOG" 2>&1 \
      && git push origin HEAD >>"$LOG" 2>&1; then
      echo "$(date -u +%FT%TZ) proxy now at $url" >>"$LOG"
      # Vercel has skipped a push before; judge by the public site, and nudge once if it stays dark.
      healthy=""
      for attempt in $(seq 1 18); do
        if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC/healthz")" = "200" ]; then
          healthy=1
          break
        fi
        if [ "$attempt" = 9 ]; then
          git commit --allow-empty -m "Redeploy so Vercel picks up the city's new tunnel." >>"$LOG" 2>&1 && git push origin HEAD >>"$LOG" 2>&1
        fi
        sleep 10
      done
      echo "$(date -u +%FT%TZ) public site ${healthy:+healthy}${healthy:-STILL DARK — check Vercel}" >>"$LOG"
    else
      echo "$(date -u +%FT%TZ) could not publish $url; update api/proxy.ts by hand" >>"$LOG"
    fi
  else
    echo "$(date -u +%FT%TZ) tunnel back on $url" >>"$LOG"
  fi
fi

wait "$TUNNEL_PID"
