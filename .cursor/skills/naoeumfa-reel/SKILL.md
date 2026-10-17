---
name: naoeumfa-reel
description: >-
  Direct Não É Um Fã commercial reels with a fixed formula: the glasses-mark
  host talks over real metaverse city footage of what is happening, rotating
  Brazilian Portuguese voices (accents, men and women), animated
  captions/emotes, one camera move per line. Use for any Não É Um Fã video,
  reel, day-one cut, episode, voiceover, host, chiptune, or emotional take.
  Never publish unless the user asks.
---

# Não É Um Fã reel — locked formula

You are the commercial director. **Every reel** follows the same grammar.
Nothing publishes unless the user asks. Copy is **pt-BR**: leve, alegre,
direto, jovem Brasil atual — sempre brincando com “não é um fã / todo mundo
é fã”. City ops (mint manual, Muse, reset) live in `naoeumfa-live`.

## The formula (never drop)

1. **Host** — glasses mark (`/brand/naoeumfa-mark.svg`) as the talking character
   (`#reel-host`): bounce, mouth squash, speech-bubble emoji, `@naoeumfa` tag.
   The host is the brand face on every cut.
2. **Metaverse footage** — real 3D city from the running planet (houses, streets,
   beams, districts). The picture proves what the line says. No stock B-roll.
3. **One line → one emotion → one camera move.** Two cuts in a row never share a move.
4. **Animated captions** — eyebrow chip + headline + sub + CTA pill on `#reel-line`
   (outside React). Emotes welcome. Last line owns the CTA.
5. **Voice roster (rotate every reel)** — same copy energy, different mouth.
   Minimum **4 Brazilian Portuguese** voices on ElevenLabs, always:
   **2 women + 2 men**, preferably distinct regional color (ex.: SP / Rio /
   Nordeste / Sul) but **same vibe**: young, social, clear, alegre, direto.
   Pick one voice per episode; never repeat the last episode’s voice if another
   roster slot is free. Set `ELEVENLABS_VOICE_ID` in `.env` for that cut (or
   pass through the render script). Model `eleven_v3`. Never Mac `say`. Never
   print the API key.

   Starter roster (expand / swap in library as needed — keep energy matched):

   | Slot | Role | Default id | Notes |
   | --- | --- | --- | --- |
   | F1 | Woman | `ORgG8rwdAiMYRug8RJwR` | Ana Alice — day-one default |
   | F2 | Woman | `5EtawPduB139avoMLQgH` | Thais — rotate |
   | M1 | Man | *(pick young BR male from library; store id in `.env` as comment or roster file)* | same energy |
   | M2 | Man | *(second young BR male, different accent)* | same energy |

   When adding M1/M2, write their ids into this table and into
   `tools/render_day_one.py` `VOICE_ROSTER` so every agent reuses the same four.
6. **Bed** — quiet instrumental chiptune / soft funk-light (ElevenLabs Music, no vocals),
   mix near `-21 dB` (`volume=0.09`). Whoosh every cut; 8-bit blip on house + final line.

## Two worlds — never mix

| World | Journal | Use |
| --- | --- | --- |
| **Live / reset** | `data/ledger.jsonl` | Real planet. Day-one post goes out on a **reset** empty city. |
| **Film plate** | `data/ledger.demo.jsonl` | Only to shoot dense metaverse plates when live is empty. |

Before the public first post: live planet stays (or goes) **reset**. Demo is
camera plate, not the published city. After day one, prefer live footage of
what actually happened (new houses, new idols, real streets).

```bash
# Film plate (demo city) — day-one / empty live
NAOEUMFA_JOURNAL_PATH=data/ledger.demo.jsonl NAOEUMFA_DEMO=0 NAOEUMFA_COMMENT_SOURCE=off \
  HOST=127.0.0.1 PORT=8787 npx tsx src/infrastructure/http/main.ts
npm run dev:web
agent/.venv/bin/python tools/render_day_one.py
```

## Shot grammar

| Beat | Feeling | Move | Frame |
| --- | --- | --- | --- |
| 1 | Hook / twist | `drift` | Planet wide |
| 2 | Day one / chapter | `snap` | Rush into a district |
| 3 | How it works | `orbit` | Circle the idol |
| 4 | House payoff | `crane` | Drop onto a door |
| 5 | Street proof | `dolly` | Eye-level door close-up |
| 6 | $NEFA pack | `truck` | Side slide another city |
| 7 | The rule | `rise` | Up toward the beam |
| 8 | CTA | `hold` | Wide ask |

## Story bible

### Episode 0 — Day one (first video must hit hard)

Goal: stop the scroll for any Brazilian. Promise the empty planet. Show the
dream with film-plate footage (“é assim que nasce”). CTA: comment now.

Spine (keep the joke + the gain):

1. Hook — “Não é um fã? Mentira. Todo mundo é fã de alguém.”
2. Open — planet opened, day one, your place is waiting.
3. Ticket — comment the idol’s `@` on `@naoeumfa`.
4. Payoff — house next door. Vizinho VIP.
5. Proof — street / door close-up. It’s real.
6. Gain — `$NEFA` pack for who plays along.
7. Rule — one mint per `@`, forever. No farm.
8. CTA — comment now. Não é um fã… é dono.

Output: `renders/naoeumfa_day_one.mp4` + `renders/day-one-caption.txt`.

### Episode 1 — Capitão (voice F2 Thais)

Hook from the new rule (A12): whoever brings the idol in first gets the only
captain tag. Ironic open (“não é fã de ninguém? conta outra”), the question
(“de quem você é fã?”), the ticket, the house, the twist (“ainda não tá aqui?
você traz”), the tag, it is yours to sell or give, FOMO close: “Não é um fã…
é capitão.” Caption names real captains as social proof.

```bash
NAOEUMFA_JOURNAL_PATH=data/ledger.demo.jsonl NAOEUMFA_DEMO=0 NAOEUMFA_COMMENT_SOURCE=off \
  HOST=127.0.0.1 PORT=8790 npx tsx src/infrastructure/http/main.ts   # film plate, live untouched
NAOEUMFA_API_URL=http://127.0.0.1:8790 npm run dev:web
NAOEUMFA_REEL_API=http://127.0.0.1:8790 agent/.venv/bin/python tools/render_day_one.py --episode capitao
```

Output: `renders/naoeumfa_capitao.mp4` + `renders/capitao-caption.txt`. Each
episode in `EPISODES` owns its roster slot; never reuse the previous episode's.

### Episode N — After things happen

Same formula. Host + **live** metaverse of the real event (new district, house
drop, idol climb, street walk). Hook from what just happened; close with the
same CTA grammar. Prefer a short dedicated render script or extend
`tools/render_day_one.py` with a named episode spine — do not invent a second
host or a second capture stack.

## Manual era (until Graph API)

Creator mints by hand via Muse. Reels still use this formula. Ops path stays
`naoeumfa-live` → `npm run muse:ingest`. You already have the tube; do not
invent a parallel one.

## Check before handoff

- Host visible and “talking” on every beat.
- Dolly is a door close-up.
- Bed quieter than voice; Ana Alice (or `.env` override).
- Film plate ≠ live ledger.
- No publish unless asked.
