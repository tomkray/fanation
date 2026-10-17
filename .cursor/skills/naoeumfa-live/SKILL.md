---
name: naoeumfa-live
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
UI copy is **pt-BR** (leve, memético, organizado). Env prefix `NAOEUMFA_*`
(legacy `FANATION_*` still read for one release). Never print secrets.

**One tube.** Muse and Meta are only different doors into the same
`ingestComments` → ledger → `avatars.enqueue` + `refresh` path. Never invent a
parallel mint or portrait system. Never publish the reel unless asked.

## One pipeline

```
comment (Muse JSON | Graph poll | webhook)
  → city.ingestComments
  → avatars.enqueue(fan, idol, owner)   // always
  → AvatarService.refresh (Muse bridge awaits before answer)
       → Business Discovery if NAOEUMFA_DISCOVERY_* set
       → else public profile og:image (same CDN cache)
  → GET /api/v1/avatars/:handle
```

When the Creator asks to “do it manually”, you still use this tube:
`npm run muse:ingest` only. **Avatars are mandatory after every mint / atualizar**
— never skip. One cache (`AvatarService` → `data/avatars` → `GET /api/v1/avatars/:handle`):

1. Muse bridge already **awaits** `refresh` for fan+idol+owner before answering.
2. If `avatars.missing` (Instagram often strips `og:image` from server-side HTML
   now): run **`npm run avatar:sync`** (Playwright opens the real profile → CDN
   URL → same `avatar:seed` cache). Or per handle:
   `npm run avatar:seed -- <handle>` then
   `npm run avatar:seed -- <handle> <cdn-or-file-url>`.
3. Prove every known handle returns **200** on local + public avatar routes.
4. Instagram verified badge: `npm run avatar:sync` reads the real profile and
   sets `instagramVerified` (blue check, same as Instagram). Only handles
   Instagram marks verified get the badge on naoeumfa.com. The world payload
   field is `instagramVerified`.

Never invent a second portrait system. Never leave a mint without faces.

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
| Muse (until IG token) | `npm run muse:ingest -- batch.json` + `NAOEUMFA_BRIDGE_SECRET` | yes |
| Graph poller | `NAOEUMFA_IG_*` + `NAOEUMFA_COMMENT_SOURCE=instagram` + `NAOEUMFA_LIVE_FROM` | yes |
| Webhook | Meta signature + same ingest | yes |

## Day-one / live checklist

1. API: `HOST=127.0.0.1 PORT=8787`, `NAOEUMFA_DEMO=0`, journal `data/ledger.jsonl`.
2. **First public post = reset planet.** Live ledger empty (or wiped) when the
   day-one reel goes out. Demo journal is only a film plate for `naoeumfa-reel`
   — never mix it into the published city.
3. Official handle: `@naoeumfa` (`NAOEUMFA_IG_USERNAME` / `OFFICIAL_INSTAGRAM_HANDLE`).
4. Public: Vercel → Cloudflare tunnel → this Mac (when API is up).
5. Bridge secret in `.env` (24+). Never paste in chat.
6. A1: one mint per `@`. Client header `X-Naoeumfa-Client`.
   Login is by Direct only (A10): fan DMs "entrar" → signed `messages` webhook →
   Meta names the account → one-time link back in that inbox → confirm → session.
   Profiles bind to Meta's account id (`data/identities.json`); a recycled @ is
   refused. Never add a code-on-screen, typed-@ or Muse login.
7. **Until Graph API:** keep minting manually via Muse
   (`npm run muse:ingest`). Same tube. Reels use `naoeumfa-reel` (host + metaverse).

## Prove

```bash
bash scripts/live-status.sh
```

## No double counting across doors

Every comment is keyed by its post's Instagram code (`ig_<shortcode>`), whether
it came from a Muse paste (`mediaUrl`), the Graph poller (`permalink`) or the
webhook (resolved once per post). So a comment pasted by hand and read again by
the API meets "one counted comment per fan per post" and never scores twice;
posts the book already holds under an old Muse hash keep that id. Always paste
the post URL in a Muse batch. `tests/adversarial.test.ts` is the cheating suite:
run it after any reducer change.

## Official account

`@naoeumfa` runs the game and never plays it: no home, XP, $NEFA, fans, idol
status, trades, ads or login (reducer `assertPlayer`, A1). When sweeping a post,
skip its own comments; never put it in a Muse batch.

## Forbidden

- A second “manual avatar pipeline” beside `AvatarService`.
- Mixing demo journal with the real planet.
- Printing tokens.
- Shipping English UI copy on the public site.
- Skipping the post sweep when the Creator asked to atualizar.
