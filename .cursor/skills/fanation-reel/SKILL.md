---
name: fanation-reel
description: >-
  Direct Fanation Club commercial reels. Match each spoken line to a different
  camera move and emotion, shoot real house close-ups from the live 3D city,
  voice with the ElevenLabs character, and bed every video with a quiet 8-bit
  chiptune from ElevenLabs Music plus cut sound effects. Use when the user
  asks for a Fanation video, reel, day-one cut, voiceover, camera angles,
  chiptune, or a more emotional or professional take.
---

# Fanation reel — director

You are the commercial director. The line decides the shot. Two cuts in a row never share a move. Nothing publishes unless the user asks.

## Voice and music

- Character: **Chris** (`iP95p4xoKVk53GoZ742B`), model `eleven_v3`. Override with `ELEVENLABS_VOICE_ID` in `.env`.
- Bed: ElevenLabs Music, instrumental 8-bit chiptune, no vocals. Mix near `-21 dB` (`volume=0.09`). The voice stays in front.
- FX: a whoosh on every cut, a small 8-bit blip on the house line and the last line. From ElevenLabs sound generation (`duration_seconds` 0.5–30).
- Read `ELEVENLABS_API_KEY` from `.env` only. Never print it, never put it in this skill, a script, a commit, or chat.

## Shot grammar

Run `agent/.venv/bin/python tools/render_day_one.py` with the dev servers up. Shots go through `setShots`, field `move`.

| Line feeling | Move | What the frame must show |
| --- | --- | --- |
| The world opens | `drift` | All four cities, slow, high |
| A question | `snap` | Rush into one district |
| The neighborhood | `orbit` | Circle the idol, zoom steady |
| The house | `crane` | Drop from the roofs onto one door |
| The street | `dolly` | Travel past doors at eye level. One house fills the frame |
| Another city | `truck` | Slide sideways, a different azimuth |
| The tower / the rule | `rise` | Lift off the street toward the beam |
| The ask | `hold` | Wide again, almost still |

Zoom on `dolly` and `crane` is a close-up (on the order of 70–130× the fitted city), not another map. Avenues stay empty road.

On-screen type is the cinematic overlay. Marks are only 🏠 💜 ⚡. The headline says what the voice says.

## Words

Day-one spine:

- The planet just went live.
- Got an idol? Comment their @.
- A house right next to them, plus the $FANT pack.
- One mint per @. Forever.
- Comment now, on @fanation.club.

Output: `renders/fanation_day_one.mp4` and `renders/day-one-caption.txt`. Open the mp4.

## Check

Scrub a still from `drift`, `dolly`, and `hold`. If `dolly` still shows a whole district, the zoom is wrong. If the bed is missing or louder than the voice, remix. If the voice is the Mac `say` voice, it is the wrong take.
