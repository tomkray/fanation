#!/usr/bin/env bash
# Prove local API + public Vercel proxy see the same live city.
set -euo pipefail
LOCAL="${NAOEUMFA_API_URL:-http://127.0.0.1:8787}"
PUBLIC="${NAOEUMFA_PUBLIC_URL:-https://fanation-roan.vercel.app}"

echo "== local $LOCAL =="
curl -sS -m 5 "$LOCAL/api/v1/config" | head -c 220; echo
curl -sS -m 8 "$LOCAL/api/v1/city" | python3 -c "
import json, sys
d = json.load(sys.stdin)
t = d['totals']
print(
    f\"version={d['version']} props={t['properties']} idols={t['idols']} \"
    f\"fans={t['activeFans']} comments={t['commentsProcessed']}\"
)
print(
    'standings:',
    ', '.join(f\"@{s['fandomHandle']}#{s['rankPosition']}\" for s in d['standings'][:8]),
)
print(
    'activity:',
    ', '.join(f\"@{a['authorUsername']}\" for a in d.get('activity', [])[:6]),
)
"

echo "== public $PUBLIC =="
curl -sS -m 12 "$PUBLIC/api/healthz"; echo
curl -sS -m 12 "$PUBLIC/api/v1/city" | python3 -c "
import json, sys
d = json.load(sys.stdin)
t = d['totals']
print(
    f\"version={d['version']} props={t['properties']} idols={t['idols']} \"
    f\"fans={t['activeFans']} comments={t['commentsProcessed']}\"
)
"
for h in tomkray bobmarley michaeljackson; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -m 10 "$PUBLIC/api/v1/avatars/$h" || echo fail)
  echo "avatar @$h → $code"
done
