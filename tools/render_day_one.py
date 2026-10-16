"""
Day-one launch reel.

Footage is the live city, cut like a film: wide planet, push into a district,
then down among the houses. Voice is the Fanation character on ElevenLabs
(Chris, American). The key is read from .env and never printed.

Re-run: agent/.venv/bin/python tools/render_day_one.py
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "renders"
FRONTEND = "http://127.0.0.1:5173"
API = "http://127.0.0.1:8787"
FPS = 24
VOICE_ID_DEFAULT = "iP95p4xoKVk53GoZ742B"  # Chris — young American, the reel character
MODEL = "eleven_v3"

LINES = [
    {
        "say": "Day one. The planet just went live.",
        "shot": "wide",
        "eyebrow": "DAY ONE",
        "headline": "The planet just went live.",
        "sub": "Four cities. One comment.",
        "cta": "🏠  Comment their @",
    },
    {
        "say": "You got an idol?",
        "shot": "push",
        "eyebrow": "YOUR IDOL",
        "headline": "You got an idol?",
        "sub": "Artist. Club. Creator. Anyone.",
        "cta": "💜  Name them",
    },
    {
        "say": "Comment their @.",
        "shot": "block",
        "eyebrow": "ONE COMMENT",
        "headline": "Comment their @.",
        "sub": "That's the whole move.",
        "cta": "⚡  Drop the @",
    },
    {
        "say": "You get a house. Right next to them.",
        "shot": "houses",
        "eyebrow": "YOUR HOUSE",
        "headline": "A house. Next door.",
        "sub": "Built beside the idol you named.",
        "cta": "🏠  Right next to them",
    },
    {
        "say": "Right down here. In the streets.",
        "shot": "street",
        "eyebrow": "DOWN HERE",
        "headline": "Down in the streets.",
        "sub": "Lamps. Blocks. Your door.",
        "cta": "🏠  This close",
    },
    {
        "say": "Plus your FANT pack.",
        "shot": "pack",
        "eyebrow": "YOUR PACK",
        "headline": "Plus your $FANT pack.",
        "sub": "Yours the moment you move in.",
        "cta": "⚡  $FANT on day one",
    },
    {
        "say": "One mint per @. Forever.",
        "shot": "tower",
        "eyebrow": "ONE MINT",
        "headline": "One @. Forever.",
        "sub": "You mint once. After that, you buy.",
        "cta": "💜  One home per @",
    },
    {
        "say": "Comment now.",
        "shot": "cta",
        "eyebrow": "GO",
        "headline": "Comment now.",
        "sub": "@fanation.club",
        "cta": "🏠  Move in today",
    },
]

CAPTION = """Day one. The planet just went live. 🏠

Got an idol? Comment their @.

You get a house right next to them.
Plus your $FANT pack. ⚡

One mint per @. Forever.

#FanationClub #DayOne #Fandom
"""


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
            "voice_settings": {"stability": 0.32, "similarity_boost": 0.82, "style": 0.55, "use_speaker_boost": True},
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


def build_voice(work: Path, key: str, voice_id: str) -> tuple[Path, list[tuple[float, float, dict]]]:
    work.mkdir(parents=True, exist_ok=True)
    gap = work / "gap.mp3"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.22", str(gap)])
    pieces: list[Path] = []
    timeline: list[tuple[float, float, dict]] = []
    cursor = 0.0
    for i, line in enumerate(LINES):
        clip = work / f"line_{i:02d}.mp3"
        speak(line["say"], clip, key, voice_id)
        length = duration_seconds(clip)
        timeline.append((cursor, cursor + length, line))
        pieces.append(clip)
        cursor += length
        if i < len(LINES) - 1:
            pieces.append(gap)
            cursor += duration_seconds(gap)
    tail = work / "tail.mp3"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.55", str(tail)])
    pieces.append(tail)
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
    # A fan's door sits a couple of blocks off the idol, not on the tower.
    door_x, door_z = bts_x + 96, bts_z - 48
    shots = []
    for start, end, line in timeline:
        kind = line["shot"]
        end = end + 0.22
        if kind == "wide":
            shot = dict(move="drift", x=0, z=0, x1=bts_x * 0.08, z1=bts_z * 0.08, zoom=0.5, zoom1=0.72, azimuth=0.2, azimuth1=0.55, polar=0.5, polar1=0.66)
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


async def capture(frames: Path, seconds: float, timeline: list[tuple[float, float, dict]], shots: list[dict]) -> None:
    from playwright.async_api import async_playwright

    frames.mkdir(parents=True, exist_ok=True)
    total = max(1, int(round(seconds * FPS)))
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--ignore-gpu-blocklist", "--enable-webgl"])
        try:
            page = await browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            await page.goto(f"{FRONTEND}/?cinematic=1&capture=1&focus=bts.bighitofficial", wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_function("() => typeof window.__fanationCinematic?.setShots === 'function'", timeout=90_000)
            await page.evaluate("(shots) => window.__fanationCinematic.setShots(shots)", shots)
            shown = -1
            for i in range(total):
                t = i / FPS
                beat = next((n for n, (a, b, _) in enumerate(timeline) if a <= t < b), len(timeline) - 1)
                if beat != shown:
                    shown = beat
                    line = timeline[beat][2]
                    await page.evaluate(
                        """(line) => {
                          const eye = document.querySelector('.cinematic__bottom .eyebrow');
                          const head = document.querySelector('.cinematic__headline');
                          const sub = document.querySelector('.cinematic__sub');
                          const cta = document.querySelector('.cinematic__cta');
                          if (eye) eye.textContent = line.eyebrow;
                          if (head) head.textContent = line.headline;
                          if (sub) sub.textContent = line.sub;
                          if (cta) cta.textContent = line.cta;
                        }""",
                        line,
                    )
                await page.evaluate("t => window.__fanationCinematic.renderFrame(t)", t)
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
            if "system_busy" not in detail and "rate" not in detail.lower():
                break
            time.sleep(6 + attempt * 3)
    raise RuntimeError(last)


def build_bed(work: Path, key: str, seconds: float) -> Path:
    """Quiet 8-bit bed from ElevenLabs Music. The voice stays in front."""
    music = work / "chiptune.mp3"
    eleven_audio(
        music,
        "https://api.elevenlabs.io/v1/music",
        {
            "prompt": (
                "Instrumental 8-bit chiptune, cheerful pixel-game loop, square-wave melody, "
                "soft drums, no vocals, no lyrics, upbeat but not loud, suitable under a voiceover"
            ),
            "music_length_ms": int(max(12, min(60, seconds + 1)) * 1000),
            "force_instrumental": True,
        },
        key,
    )
    return music


def build_sfx(work: Path, key: str, cuts: list[float]) -> Path:
    """A whoosh on each cut and a tiny blip, from ElevenLabs sound effects."""
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
    # Place a whoosh at every cut and a blip on the house line and the last line.
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
    key = env_value("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY is missing from .env")
    voice_id = env_value("ELEVENLABS_VOICE_ID") or VOICE_ID_DEFAULT
    work = OUT / "day_one_work"
    if work.exists():
        shutil.rmtree(work)
    voice, timeline = build_voice(work, key, voice_id)
    seconds = duration_seconds(voice)
    music = build_bed(work, key, seconds)
    sfx = build_sfx(work, key, [start for start, _, _ in timeline])
    frames = work / "frames"
    asyncio.run(capture(frames, seconds, timeline, shots_for(timeline)))
    video = OUT / "fanation_day_one.mp4"
    mux(frames, voice, music, sfx, video)
    (OUT / "day-one-caption.txt").write_text(CAPTION, encoding="utf-8")
    (OUT / "fanation_day_one.json").write_text(
        json.dumps(
            {"video": video.name, "seconds": round(seconds, 2), "voice": "Chris", "model": MODEL, "caption": CAPTION.strip()},
            indent=2,
        ),
        encoding="utf-8",
    )
    shutil.rmtree(work, ignore_errors=True)
    print(f"{video}  {video.stat().st_size} bytes  {seconds:.1f}s")


if __name__ == "__main__":
    main()
