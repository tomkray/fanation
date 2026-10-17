"""
Day-one launch reel — Não É Um Fã (pt-BR).

Footage is the live city, cut like a film. Voice is Ana Alice on ElevenLabs
(young Brazilian Portuguese). The key is read from .env and never printed.

Re-run: agent/.venv/bin/python tools/render_day_one.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "renders"
FRONTEND = "http://127.0.0.1:5173"
# Film plates point this at a demo API (e.g. :8790) so the live city is never touched.
API = os.environ.get("NAOEUMFA_REEL_API", "http://127.0.0.1:8787")
FPS = 24
# Voice roster: rotate across reels (2 women + 2 men, same energy, varied BR color).
# Day-one default = F1 Ana Alice. Override with ELEVENLABS_VOICE_ID in .env.
VOICE_ROSTER = {
    "F1": "ORgG8rwdAiMYRug8RJwR",  # Ana Alice
    "F2": "5EtawPduB139avoMLQgH",  # Thais
    # M1 / M2: fill with young BR male library ids (same social energy).
}
VOICE_ID_DEFAULT = VOICE_ROSTER["F1"]
MODEL = "eleven_v3"

# Episode 0 — day-one. Film plate may be demo; live planet posts reset.
LINES = [
    {
        "say": "Espera aí. Não é um fã? Mentira. Todo brasileiro é fã de alguém.",
        "shot": "wide",
        "eyebrow": "PLOT TWIST 😅",
        "headline": "Não é um fã?",
        "sub": "Mentira. Todo brasileiro é fã de alguém.",
        "cta": "💜  Spoiler: você também",
    },
    {
        "say": "A gente abriu um planeta. Do zero. Dia um. E tem lugar com o teu nome.",
        "shot": "push",
        "eyebrow": "DIA UM 🌍",
        "headline": "O planeta abriu.",
        "sub": "Do zero. Tem lugar com teu nome.",
        "cta": "🏠  Seu planeta",
    },
    {
        "say": "Tem ídolo? Comenta o arroba dele no não é um fã. Um comentário. Pronto.",
        "shot": "block",
        "eyebrow": "O TICKET ⚡",
        "headline": "Comenta o @ do ídolo.",
        "sub": "Um comentário. É o ticket.",
        "cta": "⚡  Só isso",
    },
    {
        "say": "Aí nasce tua casa. Do lado dele. Vizinho VIP. É assim que rola.",
        "shot": "houses",
        "eyebrow": "SUA CASA 🏠",
        "headline": "Casa do lado do ídolo.",
        "sub": "Vizinho VIP. É assim que rola.",
        "cta": "🏠  Next door",
    },
    {
        "say": "Chega na porta. Desce na rua. É real. É tua.",
        "shot": "street",
        "eyebrow": "BEM AQUI 🚪",
        "headline": "A porta é tua.",
        "sub": "Desce na rua. É real.",
        "cta": "👀  Olha a porta",
    },
    {
        "say": "E ainda leva o pacote Néfa. Pra quem joga junto de verdade.",
        "shot": "pack",
        "eyebrow": "PACOTE $NEFA ⚡",
        "headline": "Leva $NEFA também.",
        "sub": "Pra quem joga junto.",
        "cta": "⚡  Seu pack",
    },
    {
        "say": "Um mint por arroba. Pra sempre. Sem farmzinho. Sem papinho.",
        "shot": "tower",
        "eyebrow": "A REGRA 💜",
        "headline": "Um mint por @.",
        "sub": "Pra sempre. Sem farmzinho.",
        "cta": "💜  Forever",
    },
    {
        "say": "Comenta agora no não é um fã. Vem. Não é um fã… é dono.",
        "shot": "cta",
        "eyebrow": "VEM COM A GENTE 🚀",
        "headline": "Comenta no @naoeumfa",
        "sub": "Não é um fã… é dono.",
        "cta": "🏠  Muda hoje",
    },
]

CAPTION = """Espera aí. Não é um fã? Mentira. Todo brasileiro é fã de alguém. 😅

A gente abriu um planeta. Do zero. Dia um. 🌍
Tem ídolo? Comenta o @ dele no @naoeumfa. Um comentário. Pronto. ⚡

Tua casa nasce do lado dele. Vizinho VIP. 🏠
Mais o pacote $NEFA. Pra quem joga junto. ⚡

Um mint por @. Pra sempre. Sem farmzinho.
Comenta agora. @naoeumfa
Não é um fã… é dono. 💜

#NaoeUmFa #DiaUm #NaoEUmFa #Fandom #Brasil
"""

# Episode 1 — capitão. The new rule (A12) is the hook: first to bring the idol in
# gets the only captain tag. Short lines, one ironic beat, FOMO at the end.
CAPITAO_LINES = [
    {
        "say": "Você... não é fã de ninguém? [laughs] Tá. Conta outra.",
        "shot": "wide",
        "eyebrow": "CONFIA 😏",
        "headline": "Não é fã de ninguém?",
        "sub": "Conta outra.",
        "cta": "🙄  Até parece",
    },
    {
        "say": "Fala a verdade: de quem você é fã?",
        "shot": "push",
        "eyebrow": "PERGUNTA SÉRIA 🎤",
        "headline": "De quem você é fã?",
        "sub": "Pensou em alguém. A gente viu.",
        "cta": "👀  Pensou, né",
    },
    {
        "say": "Então faz o básico: comenta o arroba dele no post.",
        "shot": "block",
        "eyebrow": "O BÁSICO ⚡",
        "headline": "Comenta o @ dele.",
        "sub": "Um comentário. Só isso.",
        "cta": "⚡  @seu_idolo",
    },
    {
        "say": "Pronto. Tua casa nasce do lado dele.",
        "shot": "houses",
        "eyebrow": "RECOMPENSA 🏠",
        "headline": "Casa do lado do ídolo.",
        "sub": "Vizinho de quem você ama.",
        "cta": "🏠  Mudança grátis",
    },
    {
        "say": "E se ele ainda não tá na cidade? Você que traz.",
        "shot": "street",
        "eyebrow": "PLOT TWIST 🌀",
        "headline": "Ainda não tá aqui?",
        "sub": "Você traz.",
        "cta": "🚪  Abre a porta",
    },
    {
        "say": "Quem traz primeiro vira capitão. Tag dourada. Só existe uma.",
        "shot": "tower",
        "eyebrow": "CAPITÃO 🎖️",
        "headline": "Trouxe primeiro? Capitão.",
        "sub": "Uma tag por ídolo. Pra sempre.",
        "cta": "🎖️  Só uma",
    },
    {
        "say": "Dá pra vender, dá pra dar de presente. Mas ser o primeiro... só um.",
        "shot": "pack",
        "eyebrow": "É TUA 💸",
        "headline": "Vende ou dá de presente.",
        "sub": "Tag, casa, $NEFA: tudo teu.",
        "cta": "💸  Valendo",
    },
    {
        "say": "Corre, comenta o arroba do teu ídolo antes que alguém chegue primeiro. Não é um fã... é capitão.",
        "shot": "cta",
        "eyebrow": "AGORA 🚀",
        "headline": "Não é um fã… é capitão.",
        "sub": "Comenta o @ do teu ídolo no @naoeumfa.",
        "cta": "🎖️  Corre",
    },
]

CAPITAO_CAPTION = """Regra nova na cidade: quem traz o ídolo primeiro vira capitão 🎖️

Como funciona:
→ comenta o @ do teu ídolo aqui
→ tua casa nasce do lado dele
→ se ele ainda não tava na cidade, a tag de capitão é tua

Uma tag por ídolo. Pra sempre. Dá pra vender ou dar de presente.
Já tem capitão: @tomkray (@michaeljackson) e @naoeumagincana (@bobmarley).
E o teu ídolo, vai ficar sem?

naoeumfa.com

#NaoeUmFa #Capitao
"""

EPISODES = {
    "day-one": {"lines": LINES, "caption": CAPTION, "voice": "F1", "voiceName": "Ana Alice", "stem": "naoeumfa_day_one", "captionFile": "day-one-caption.txt"},
    "capitao": {"lines": CAPITAO_LINES, "caption": CAPITAO_CAPTION, "voice": "F2", "voiceName": "Thais", "stem": "naoeumfa_capitao", "captionFile": "capitao-caption.txt"},
}


def env_value(name: str) -> str:
    path = ROOT / ".env"
    if not path.is_file():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def duration_seconds(path: Path) -> float:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(probe.stdout.strip())


def speak(text: str, dest: Path, key: str, voice_id: str) -> None:
    payload = json.dumps(
        {
            "text": text,
            "model_id": MODEL,
            "voice_settings": {"stability": 0.28, "similarity_boost": 0.85, "style": 0.72, "use_speaker_boost": True},
        }
    ).encode()
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
        data=payload,
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        dest.write_bytes(response.read())


def build_voice(work: Path, key: str, voice_id: str, lines: list[dict]) -> tuple[Path, list[tuple[float, float, dict]]]:
    work.mkdir(parents=True, exist_ok=True)
    gap = work / "gap.mp3"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.18", str(gap)])
    pieces: list[Path] = []
    timeline: list[tuple[float, float, dict]] = []
    cursor = 0.0
    for i, line in enumerate(lines):
        clip = work / f"line_{i:02d}.mp3"
        speak(line["say"], clip, key, voice_id)
        length = duration_seconds(clip)
        start = cursor
        pieces.append(clip)
        cursor += length
        if i < len(lines) - 1:
            pieces.append(gap)
            cursor += duration_seconds(gap)
        timeline.append((start, cursor, line))
    tail = work / "tail.mp3"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.55", str(tail)])
    pieces.append(tail)
    if timeline:
        start, end, line = timeline[-1]
        timeline[-1] = (start, end + duration_seconds(tail), line)
    listing = work / "voice.txt"
    listing.write_text("".join(f"file '{piece}'\n" for piece in pieces), encoding="utf-8")
    voice = work / "voice.wav"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-ar", "48000", "-ac", "1", str(voice)])
    return voice, timeline


def district(handle: str) -> tuple[float, float]:
    with urllib.request.urlopen(f"{API}/api/v1/world", timeout=20) as response:
        world = json.load(response)
    for standing in world.get("standings") or []:
        if standing.get("fandomHandle") == handle:
            return float(standing["districtX"]), float(standing["districtZ"])
    return 0.0, 0.0


def shots_for(timeline: list[tuple[float, float, dict]]) -> list[dict]:
    """One grammar per line. No two cuts share a move."""
    bts_x, bts_z = district("bts.bighitofficial")
    madrid_x, madrid_z = district("realmadrid")
    door_x, door_z = bts_x + 96, bts_z - 48
    shots = []
    for start, end, line in timeline:
        kind = line["shot"]
        end = end + 0.22
        if kind == "wide":
            shot = dict(move="drift", view="planet", x=0, z=0, x1=0, z1=0, zoom=0.92, zoom1=1.08, azimuth=0.35, azimuth1=0.85, polar=0.82, polar1=0.98)
        elif kind == "push":
            shot = dict(move="snap", x=bts_x * 0.55, z=bts_z * 0.55, x1=bts_x, z1=bts_z, zoom=1.1, zoom1=5.5, azimuth=2.4, azimuth1=2.55, polar=0.7, polar1=0.95)
        elif kind == "block":
            shot = dict(move="orbit", x=bts_x, z=bts_z, x1=bts_x, z1=bts_z, zoom=7, zoom1=8, azimuth=0.4, azimuth1=1.9, polar=0.95, polar1=1.02)
        elif kind == "houses":
            shot = dict(move="crane", x=door_x, z=door_z, x1=door_x + 8, z1=door_z + 6, zoom=28, zoom1=70, azimuth=0.9, azimuth1=1.05, polar=0.85, polar1=1.32)
        elif kind == "street":
            shot = dict(move="dolly", x=door_x - 18, z=door_z + 14, x1=door_x + 36, z1=door_z - 8, zoom=110, zoom1=130, azimuth=1.55, azimuth1=1.7, polar=1.38, polar1=1.42)
        elif kind == "pack":
            shot = dict(move="truck", x=madrid_x - 70, z=madrid_z + 30, x1=madrid_x + 50, z1=madrid_z + 36, zoom=36, zoom1=42, azimuth=3.6, azimuth1=3.9, polar=1.22, polar1=1.3)
        elif kind == "tower":
            shot = dict(move="rise", x=bts_x + 30, z=bts_z + 18, x1=bts_x, z1=bts_z, zoom=22, zoom1=6, azimuth=4.4, azimuth1=5.1, polar=1.28, polar1=0.62)
        else:
            shot = dict(move="hold", x=0, z=40, x1=20, z1=10, zoom=0.95, zoom1=0.7, azimuth=5.4, azimuth1=5.55, polar=0.68, polar1=0.58)
        shot["t0"] = start
        shot["t1"] = max(end, start + 0.4)
        shots.append(shot)
    if shots:
        shots[-1]["t1"] = timeline[-1][1] + 0.8
    return shots


REEL_PAINT_JS = """([t, line, lineStart]) => {
  const font = 'ui-rounded,-apple-system,\"SF Pro Rounded\",system-ui,sans-serif';
  const age = Math.max(0, t - lineStart);
  const pop = Math.min(1, age / 0.22);
  const lift = (1 - pop) * 28;
  const soft = Math.min(1, age / 0.45);
  // Talk bounce: jaw + float while the VO line is live.
  const talk = 0.5 + 0.5 * Math.sin(t * 18.5);
  const bob = Math.sin(t * 3.2) * 6;
  const sway = Math.sin(t * 2.1) * 4;
  const mouth = 0.94 + talk * 0.1;
  const faceScale = 1 + talk * 0.035;

  let host = document.querySelector('#reel-host');
  if (!host) {
    host = document.createElement('aside');
    host.id = 'reel-host';
    document.body.appendChild(host);
  }
  host.replaceChildren();
  host.style.cssText = `position:fixed;left:28px;top:232px;z-index:45;width:280px;pointer-events:none;font-family:${font};transform:translate(${sway}px,${bob}px);`;

  const stack = document.createElement('div');
  stack.style.cssText = 'position:relative;width:220px;height:220px;';

  const glow = document.createElement('div');
  glow.style.cssText = `position:absolute;inset:-18px;border-radius:50%;background:radial-gradient(circle,rgba(100,210,255,${0.35 + talk * 0.25}) 0%,rgba(10,132,255,0.08) 55%,transparent 70%);transform:scale(${faceScale});`;
  stack.appendChild(glow);

  const ring = document.createElement('div');
  ring.style.cssText = `position:absolute;inset:0;border-radius:50%;padding:6px;background:linear-gradient(145deg,#64d2ff,#0a84ff 55%,#fff);box-shadow:0 18px 40px rgba(0,0,0,0.45),0 0 0 3px rgba(255,255,255,0.15);transform:scale(${faceScale});`;
  const face = document.createElement('img');
  face.src = '/brand/naoeumfa-mark.svg';
  face.alt = '';
  face.style.cssText = `display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#45494E;transform:scaleY(${mouth});transform-origin:50% 62%;`;
  ring.appendChild(face);
  stack.appendChild(ring);

  const bubble = document.createElement('div');
  bubble.textContent = line.cta.split('  ').pop() || '💜';
  bubble.style.cssText = `position:absolute;right:-42px;top:-8px;min-width:72px;padding:12px 16px;border-radius:22px 22px 22px 8px;background:rgba(8,9,11,0.88);border:2px solid rgba(100,210,255,0.65);color:#fff;font-size:34px;font-weight:800;text-align:center;box-shadow:0 12px 28px rgba(0,0,0,0.4);opacity:${0.55 + soft * 0.45};transform:scale(${0.85 + pop * 0.15});`;
  stack.appendChild(bubble);
  host.appendChild(stack);

  const name = document.createElement('p');
  name.textContent = '@naoeumfa';
  name.style.cssText = 'margin:10px 0 0 8px;font-size:26px;font-weight:800;color:#9fd4ff;text-shadow:0 4px 16px rgba(0,0,0,0.55);letter-spacing:0.02em;';
  host.appendChild(name);

  const foot = document.querySelector('#reel-line');
  if (foot) {
    foot.replaceChildren();
    foot.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;flex-direction:column;gap:10px;padding:0 36px 64px;pointer-events:none;font-family:${font};`;

    const chip = document.createElement('span');
    chip.textContent = line.eyebrow;
    chip.style.cssText = `align-self:flex-start;padding:10px 16px;border-radius:999px;background:rgba(10,132,255,0.22);border:1px solid rgba(122,198,255,0.55);color:#9fd4ff;font-size:26px;font-weight:800;letter-spacing:0.04em;transform:translateY(${lift * 0.6}px) scale(${0.92 + pop * 0.08});opacity:${0.35 + soft * 0.65};`;
    foot.appendChild(chip);

    const title = document.createElement('p');
    title.textContent = line.headline;
    title.style.cssText = `margin:0;font-size:64px;font-weight:800;line-height:1.02;letter-spacing:-1.2px;color:#fff;text-shadow:0 10px 40px rgba(0,0,0,0.55),0 0 24px rgba(58,214,255,0.35);transform:translateY(${lift}px);opacity:${0.2 + pop * 0.8};`;
    foot.appendChild(title);

    const sub = document.createElement('p');
    sub.textContent = line.sub;
    sub.style.cssText = `margin:0;font-size:34px;font-weight:600;color:rgba(255,255,255,0.82);transform:translateY(${lift * 0.7}px);opacity:${soft};`;
    foot.appendChild(sub);

    const cta = document.createElement('p');
    cta.textContent = line.cta;
    cta.style.cssText = `margin:10px 0 0;align-self:flex-start;padding:14px 24px;border-radius:999px;background:linear-gradient(135deg,#0a84ff,#64d2ff);color:#fff;font-size:30px;font-weight:800;box-shadow:0 12px 32px rgba(10,132,255,0.45);transform:translateY(${(1-pop)*18}px) scale(${0.9 + pop * 0.1});opacity:${pop};`;
    foot.appendChild(cta);
  }
  window.__naoeumfaCinematic.renderFrame(t);
}"""


async def capture(frames: Path, seconds: float, timeline: list[tuple[float, float, dict]], shots: list[dict]) -> None:
    from playwright.async_api import async_playwright

    frames.mkdir(parents=True, exist_ok=True)
    total = max(1, int(round(seconds * FPS)))
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--ignore-gpu-blocklist", "--enable-webgl"])
        try:
            page = await browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            await page.goto(f"{FRONTEND}/?cinematic=1&capture=1&focus=bts.bighitofficial", wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_function("() => typeof window.__naoeumfaCinematic?.setShots === 'function'", timeout=90_000)
            await page.evaluate("(shots) => window.__naoeumfaCinematic.setShots(shots)", shots)
            await page.evaluate(
                """() => {
                  const reactFoot = document.querySelector('#reel-caption');
                  if (reactFoot) reactFoot.remove();
                  const own = document.createElement('footer');
                  own.id = 'reel-line';
                  document.body.appendChild(own);
                }"""
            )
            for i in range(total):
                t = i / FPS
                line = timeline[0][2]
                line_start = timeline[0][0]
                for start, end, candidate in timeline:
                    if start <= t < end:
                        line = candidate
                        line_start = start
                        break
                    if start <= t:
                        line = candidate
                        line_start = start
                await page.evaluate(REEL_PAINT_JS, [t, line, line_start])
                await page.screenshot(path=str(frames / f"frame_{i:05d}.jpg"), type="jpeg", quality=90)
        finally:
            await browser.close()


def eleven_audio(path: Path, url: str, payload: dict, key: str) -> None:
    import time

    body = json.dumps(payload).encode()
    last = "ElevenLabs audio failed"
    for attempt in range(6):
        request = urllib.request.Request(
            url,
            data=body,
            headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                path.write_bytes(response.read())
            return
        except Exception as exc:
            detail = exc.read().decode()[:240] if hasattr(exc, "read") else str(exc)
            last = detail
            # Transient on ElevenLabs' side (they say so and do not charge); anything else is final.
            transient = ("system_busy", "service_unavailable", "something_went_wrong")
            if not any(code in detail for code in transient) and "rate" not in detail.lower():
                break
            time.sleep(6 + attempt * 3)
    raise RuntimeError(last)


def build_bed(work: Path, key: str, seconds: float) -> Path:
    music = work / "chiptune.mp3"
    eleven_audio(
        music,
        "https://api.elevenlabs.io/v1/music",
        {
            "prompt": (
                "Instrumental Brazilian funk-light 8-bit chiptune hybrid, cheerful young social reel bed, "
                "soft drums, playful melody, no vocals, no lyrics, upbeat but quiet under a voiceover"
            ),
            "music_length_ms": int(max(12, min(60, seconds + 1)) * 1000),
            "force_instrumental": True,
        },
        key,
    )
    return music


def build_sfx(work: Path, key: str, cuts: list[float]) -> Path:
    whoosh = work / "whoosh.mp3"
    blip = work / "blip.mp3"
    eleven_audio(
        whoosh,
        "https://api.elevenlabs.io/v1/sound-generation",
        {"text": "short soft camera whoosh, airy, no music", "duration_seconds": 0.6, "prompt_influence": 0.4},
        key,
    )
    eleven_audio(
        blip,
        "https://api.elevenlabs.io/v1/sound-generation",
        {"text": "tiny 8-bit coin blip, one note, very short", "duration_seconds": 0.5, "prompt_influence": 0.5},
        key,
    )
    inputs = ["-i", str(whoosh), "-i", str(blip)]
    filters = []
    labels = []
    for i, at in enumerate(cuts):
        delay = max(0, int(at * 1000))
        filters.append(f"[0:a]adelay={delay}|{delay},volume=0.45[w{i}]")
        labels.append(f"[w{i}]")
    house_at = cuts[3] if len(cuts) > 3 else 0
    end_at = cuts[-1] if cuts else 0
    filters.append(f"[1:a]adelay={int(house_at * 1000)}|{int(house_at * 1000)},volume=0.35[b0]")
    filters.append(f"[1:a]adelay={int(end_at * 1000)}|{int(end_at * 1000)},volume=0.35[b1]")
    labels.extend(["[b0]", "[b1]"])
    filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:dropout_transition=0,volume=0.8[sfx]")
    sfx = work / "sfx.wav"
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[sfx]", "-ar", "48000", str(sfx)])
    return sfx


def mux(frames: Path, voice: Path, music: Path, sfx: Path, out: Path) -> None:
    run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(FPS),
            "-i", str(frames / "frame_%05d.jpg"),
            "-i", str(voice),
            "-stream_loop", "-1", "-i", str(music),
            "-i", str(sfx),
            "-filter_complex",
            "[1:a]volume=1.0[voice];"
            "[2:a]volume=0.09[bed];"
            "[3:a]volume=0.7[fx];"
            "[voice][bed][fx]amix=inputs=3:duration=first:dropout_transition=0:normalize=0[a]",
            "-map", "0:v", "-map", "[a]",
            "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p",
            "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-movflags", "+faststart",
            str(out),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a Não É Um Fã reel.")
    parser.add_argument("--episode", choices=sorted(EPISODES), default="day-one")
    args = parser.parse_args()
    episode = EPISODES[args.episode]

    key = env_value("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY is missing from .env")
    # Each episode owns its roster slot so voices rotate; .env only covers day one.
    voice_id = VOICE_ROSTER[episode["voice"]] if args.episode != "day-one" else env_value("ELEVENLABS_VOICE_ID") or VOICE_ID_DEFAULT
    work = OUT / f"{episode['stem']}_work"
    if work.exists():
        shutil.rmtree(work)
    voice, timeline = build_voice(work, key, voice_id, episode["lines"])
    seconds = duration_seconds(voice)
    music = build_bed(work, key, seconds)
    sfx = build_sfx(work, key, [start for start, _, _ in timeline])
    frames = work / "frames"
    asyncio.run(capture(frames, seconds, timeline, shots_for(timeline)))
    video = OUT / f"{episode['stem']}.mp4"
    mux(frames, voice, music, sfx, video)
    (OUT / episode["captionFile"]).write_text(episode["caption"], encoding="utf-8")
    (OUT / f"{episode['stem']}.json").write_text(
        json.dumps(
            {
                "episode": args.episode,
                "video": video.name,
                "seconds": round(seconds, 2),
                "voice": episode["voiceName"],
                "voiceId": voice_id,
                "model": MODEL,
                "language": "pt-BR",
                "caption": episode["caption"].strip(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    shutil.rmtree(work, ignore_errors=True)
    print(f"{video}  {video.stat().st_size} bytes  {seconds:.1f}s")


if __name__ == "__main__":
    main()
