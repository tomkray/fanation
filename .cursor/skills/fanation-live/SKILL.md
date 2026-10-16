---
name: fanation-live
description: >-
  Run Fanation Club day-one and live city ops: Instagram comment minting
  (Muse bridge or Graph poller), profile avatars (one AvatarService pipeline),
  Vercel proxy to this Mac, ledger/$FANT rules. Use when the user mentions
  Fanation live, Muse comments, avatar photos, mint houses from Instagram,
  bridge ingest, Discovery token, or fanation-roan.vercel.app.
---

# Fanation live — city ops

**One tube.** Muse and Meta are only different doors into the same
`ingestComments` → ledger → `avatars.enqueue` path. Never invent a parallel
mint or portrait system. Never print secrets. Never publish the reel unless asked.

## One pipeline

```
comment (Muse JSON | Graph poll | webhook)
  → city.ingestComments
  → avatars.enqueue(fan, idol, owner)   // always
  → AvatarService.refresh
       → Business Discovery if FANATION_DISCOVERY_* set
       → else public profile og:image (same CDN cache)
  → GET /api/v1/avatars/:handle
```

When the Creator asks to “do it manually”, you still use this tube:
`npm run muse:ingest` only. The bridge **refreshes fan+idol avatars before
it answers** (same `AvatarService` as Graph). Only if the response lists
`avatars.missing` may you inject CDN bytes via `avatars.seed` /
`npm run avatar:seed` (same cache, escape hatch only).

## Doors (not forks)

| Door | How | Same after the door? |
| --- | --- | --- |
| Muse (until IG token) | `npm run muse:ingest -- batch.json` + `FANATION_BRIDGE_SECRET` | yes |
| Graph poller | `FANATION_IG_*` + `FANATION_COMMENT_SOURCE=instagram` + `FANATION_LIVE_FROM` | yes |
| Webhook | Meta signature + same ingest | yes |

## Day-one / live checklist

1. API: `HOST=127.0.0.1 PORT=8787`, `FANATION_DEMO=0`, journal `data/ledger.jsonl`.
2. Public: Vercel → Cloudflare tunnel → this Mac. Keep Mac + `cloudflared` up.
3. Bridge secret in `.env` (24+). Never paste in chat.
4. A1: one mint per `@`. Dedupe by Meta id or stable Muse hash.

## Muse batch

```bash
npm run muse:ingest -- path/to/batch.json
```

JSON: `mediaId` + `comments[{ authorUsername, text, timestamp?, commentId? }]`.
Same batch twice → no double mint. Portraits enqueue automatically.

## Avatars

- Preferred: `FANATION_DISCOVERY_ACCESS_TOKEN` + `FANATION_DISCOVERY_IG_USER_ID`.
- Until then: same queue uses public-page lookup. No second system.
- Escape hatch only: `npm run avatar:seed -- <handle> [file|url]` writes into **the same** `data/avatars` cache.

## Prove

```bash
curl -s http://127.0.0.1:8787/api/v1/config
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/v1/avatars/tomkray
```

## Push / Vercel

Ledger + avatar **bytes** stay on the Mac. Push only for code/UI changes.

## Forbidden

- A second “manual avatar pipeline” beside `AvatarService`.
- Mixing demo journal with the real planet.
- Printing tokens.
