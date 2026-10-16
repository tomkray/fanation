#!/usr/bin/env python3
"""
Não É Um Fã city ambient — ElevenLabs Music → seamless site loop.

  agent/.venv/bin/python tools/generate_city_ambient.py

Writes public/assets/audio/city-ambient.mp3 (≈80s, 7s fade in / 7s fade out).
Never prints the API key.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "audio" / "city-ambient.mp3"
LENGTH_MS = 80_000  # 1:20
FADE_S = 7.0
PROMPT = (
    "Instrumental ambient soundscape for a living neon isometric fan city at night. "
    "Soft distant city hum, gentle warm synth pads, subtle airy textures, very quiet "
    "chiptune sparkle in the far background, calm hopeful mood, no vocals, no lyrics, "
    "no drums that punch, no sirens, no dialogue, seamless looping atmosphere under a 3D map."
)


def load_key() -> str:
    env = ROOT / ".env"
    if not env.is_file():
        raise SystemExit(".env missing")
    for line in env.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if key:
                return key
    raise SystemExit("ELEVENLABS_API_KEY missing from .env")


def compose(key: str, dest: Path) -> None:
    body = json.dumps(
        {
            "prompt": PROMPT,
            "music_length_ms": LENGTH_MS,
            "force_instrumental": True,
            "model_id": "music_v2_5",
        }
    ).encode()
    last = "ElevenLabs music failed"
    for attempt in range(6):
        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/music",
            data=body,
            headers={
                "xi-api-key": key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                dest.write_bytes(res.read())
            return
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            last = f"HTTP {exc.code}: {detail}"
            if "system_busy" not in detail and "rate" not in detail.lower():
                break
            time.sleep(6 + attempt * 3)
        except Exception as exc:  # noqa: BLE001 — retry then surface
            last = str(exc)
            time.sleep(4 + attempt * 2)
    raise SystemExit(last)


def fade_loop(src: Path, dest: Path) -> None:
    duration_s = LENGTH_MS / 1000.0
    fade_out_start = max(0.0, duration_s - FADE_S)
    dest.parent.mkdir(parents=True, exist_ok=True)
    af = f"afade=t=in:st=0:d={FADE_S},afade=t=out:st={fade_out_start}:d={FADE_S}"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-af",
            af,
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(dest),
        ],
        check=True,
        capture_output=True,
    )


def main() -> int:
    key = load_key()
    with tempfile.TemporaryDirectory(prefix="naoeumfa-ambient-") as tmp:
        raw = Path(tmp) / "raw.mp3"
        print(f"composing {LENGTH_MS // 1000}s city ambient via ElevenLabs Music…")
        compose(key, raw)
        print(f"applying {FADE_S:.0f}s fade in / fade out…")
        fade_loop(raw, OUT)
    size = OUT.stat().st_size
    print(f"✓ {OUT.relative_to(ROOT)} ({size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
