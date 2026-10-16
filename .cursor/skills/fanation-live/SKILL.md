---
name: fanation-live
description: >-
  Run Não É Um Fã (naoeumfa.com) day-one and live city ops: Instagram comment
  minting (Muse bridge or Graph poller), profile avatars (one AvatarService
  pipeline), Vercel proxy to this Mac, ledger/$NEFA rules. Use when the user
  mentions Não É Um Fã, naoeumfa, Fanation live (legacy name), Muse comments,
  avatar photos, mint houses from Instagram, bridge ingest, Discovery token,
  fanation-roan.vercel.app, atualizar, passar geral, or sweep Instagram posts.
---

# Não É Um Fã — city ops

**Brand (locked):** Não É Um Fã · `naoeumfa.com` · Instagram `@naoeumfa` · token `$NEFA`.
UI copy is **pt-BR** (leve, memético, organizado). Legacy repo/env prefix
`FANATION_*` may remain for ops — never print secrets.

**One tube.** Muse and Meta are only different doors into the same
`ingestComments` → ledger → `avatars.enqueue` + `refresh` path. Never invent a
parallel mint or portrait system. Never publish the reel unless asked.

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
it answers**. Only if the response lists `avatars.missing` may you inject CDN
bytes via `avatars.seed` / `npm run avatar:seed` (escape hatch only).

## Atualizar / passar geral (DYNAMIC — always)

Triggers: *atualizar*, *passa geral*, *sweep*, *vê os posts*, *novos
comentários*, *atualiza a cidade*, or a new Instagram permalink.

1. **Registry** — `scripts/live-posts.json` (`account: @naoeumfa`). Append new URLs.
2. **Pulse** — `bash scripts/live-status.sh`. Recycle API/tunnel if needed
   (`reup-api.sh` / `reup-public.sh`); update proxy fallback + push when asked.
3. **See comments** — open each post; collect every visible comment. Login wall →
   ask Creator for Muse dump. Never invent comments.
4. **Ingest** — `npm run muse:ingest -- batch.json` → expect `avatars.ok` / `missing`.
5. **Prove** — live-status + public site. Report only the delta.

## Doors (not forks)

| Door | How | Same after the door? |
| --- | --- | --- |
| Muse (until IG token) | `npm run muse:ingest -- batch.json` + `FANATION_BRIDGE_SECRET` | yes |
| Graph poller | `FANATION_IG_*` + `FANATION_COMMENT_SOURCE=instagram` + `FANATION_LIVE_FROM` | yes |
| Webhook | Meta signature + same ingest | yes |

## Day-one / live checklist

1. API: `HOST=127.0.0.1 PORT=8787`, `FANATION_DEMO=0`, journal `data/ledger.jsonl`.
2. Official handle: `@naoeumfa` (`FANATION_IG_USERNAME` / `OFFICIAL_INSTAGRAM_HANDLE`).
3. Public: Vercel → Cloudflare tunnel → this Mac.
4. Bridge secret in `.env` (24+). Never paste in chat.
5. A1: one mint per `@`. Connect codes are `NEFA-XXXXXX`. Client header `X-Naoeumfa-Client`.

## Prove

```bash
bash scripts/live-status.sh
```

## Forbidden

- A second “manual avatar pipeline” beside `AvatarService`.
- Mixing demo journal with the real planet.
- Printing tokens.
- Shipping English UI copy on the public site.
- Skipping the post sweep when the Creator asked to atualizar.
