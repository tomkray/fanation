---
name: fanation-live
description: >-
  Run Fanation Club day-one and live city ops: Instagram comment minting
  (Muse bridge or Graph poller), profile avatars (one AvatarService pipeline),
  Vercel proxy to this Mac, ledger/$FANT rules. Use when the user mentions
  Fanation live, Muse comments, avatar photos, mint houses from Instagram,
  bridge ingest, Discovery token, fanation-roan.vercel.app, atualizar,
  passar geral, or sweep Instagram posts.
---

# Fanation live — city ops

**One tube.** Muse and Meta are only different doors into the same
`ingestComments` → ledger → `avatars.enqueue` + `refresh` path. Never invent a
parallel mint or portrait system. Never print secrets. Never publish the reel
unless asked.

## One pipeline

```
comment (Muse JSON | Graph poll | webhook)
  → city.ingestComments
  → avatars.enqueue(fan, idol, owner)   // always
  → AvatarService.refresh (Muse bridge awaits before answer)
       → Business Discovery if FANATION_DISCOVERY_* set
       → else public profile og:image (same CDN cache)
  → GET /api/v1/avatars/:handle
```

When the Creator asks to “do it manually”, you still use this tube:
`npm run muse:ingest` only. The bridge **refreshes fan+idol avatars before
it answers** (same `AvatarService` as Graph). Only if the response lists
`avatars.missing` may you inject CDN bytes via `avatars.seed` /
`npm run avatar:seed` (same cache, escape hatch only).

## Atualizar / passar geral (DYNAMIC — always)

Triggers (any language / shorthand): *atualizar*, *passa geral*, *sweep*,
*vê os posts*, *novos comentários*, *atualiza a cidade*, or when the Creator
drops a new Instagram permalink and asks to pull it in.

**Do this every time — do not reuse a stale mental snapshot of the city.**

1. **Registry** — read `scripts/live-posts.json`. If the Creator names a new
   post URL, append it there before sweeping.
2. **Pulse** — `bash scripts/live-status.sh` (local + Vercel). If local API is
   down: ask Creator to run `bash scripts/reup-api.sh`. If public healthz fails
   but local is up: recycle tunnel (`reup-public.sh`), update
   `api/proxy.ts` + `api/healthz.ts` fallback URL, push when asked.
3. **See comments live** — for **each** URL in `live-posts.json`, open the
   Instagram permalink in the browser (or Muse JSON the Creator pasted) and
   collect **every visible comment** (`authorUsername` + `text` + time if
   shown). Login walls: ask Creator for a Muse dump of that post — never invent
   comments.
4. **Ingest** — write a batch JSON (temp under `/tmp` or `data/` — `data/` is
   gitignored) and run:
   ```bash
   npm run muse:ingest -- /path/to/batch.json
   ```
   Same comment twice → no double mint (stable Muse hash). Expect response
   `avatars.ok` / `avatars.missing`.
5. **Prove** — re-run `bash scripts/live-status.sh` and confirm
   [fanation-roan.vercel.app](https://fanation-roan.vercel.app/) shows the new
   houses / ranking / Live feed. Report only the delta (new fans, idols, missing
   avatars).

Avatars are **not** a second step after a healthy Muse answer. They travel in
the same request.

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
5. Tracked posts live in `scripts/live-posts.json` (committed).

## Muse batch

```bash
npm run muse:ingest -- path/to/batch.json
```

JSON: `mediaUrl` or `mediaId` + `comments[{ authorUsername, text, timestamp?, commentId? }]`.
Same batch twice → no double mint. Portraits enqueue + refresh automatically.

## Avatars

- Preferred: `FANATION_DISCOVERY_ACCESS_TOKEN` + `FANATION_DISCOVERY_IG_USER_ID`.
- Until then: same queue uses public-page lookup. No second system.
- Escape hatch only: `npm run avatar:seed -- <handle> [file|url]` writes into **the same** `data/avatars` cache.

## Prove

```bash
bash scripts/live-status.sh
```

## Push / Vercel

Ledger + avatar **bytes** stay on the Mac. Push only for code/UI/proxy URL changes.

## Forbidden

- A second “manual avatar pipeline” beside `AvatarService`.
- Mixing demo journal with the real planet.
- Printing tokens.
- Skipping the post sweep when the Creator asked to atualizar.
