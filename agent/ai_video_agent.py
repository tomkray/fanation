"""
Fanation Club — autonomous media agent.

Each cycle:
  1. reads the live city and the global ranking from the API;
  2. renders a deterministic 9:16 (1080x1920) take of the 3D city focused on
     the #1 fandom, frame by frame, and encodes it with FFmpeg (H.264);
  3. writes a caption with the call to action and the biggest climber;
  4. publishes to Instagram Reels (@fanation.club) and TikTok when credentials
     exist, otherwise records an honest dry-run (no fake ids).

  agent/.venv/bin/python agent/ai_video_agent.py --once [--dry-run]
  agent/.venv/bin/python agent/ai_video_agent.py --every-minutes 60
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx


def load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal KEY=VALUE reader; values already in the environment win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()

GRAPH_BASE = os.environ.get("FANATION_GRAPH_BASE_URL") or "https://graph.instagram.com/v23.0"
TIKTOK_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
HANDLE_SANITIZE_RE = re.compile(r"[^a-z0-9._]")
REQUEST_TIMEOUT = httpx.Timeout(30.0, read=120.0)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "fanation-media-agent",
            "level": record.levelname,
            "event": record.getMessage(),
        }
        payload.update(getattr(record, "fields", {}))
        return json.dumps(payload, ensure_ascii=False)


handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logger = logging.getLogger("fanation_media_agent")
logger.addHandler(handler)
logger.setLevel(logging.INFO)


def log(event: str, level: int = logging.INFO, **fields: object) -> None:
    logger.log(level, event, extra={"fields": fields})


class RenderError(RuntimeError):
    pass


class PublishError(RuntimeError):
    pass


@dataclass(frozen=True)
class CitySnapshot:
    total_homes: int
    leader_handle: Optional[str]
    leader_fans: int
    runner_up_handle: Optional[str]
    runner_up_fans: int
    climber_handle: Optional[str]
    climber_rank: int
    climber_delta: int
    captured_at_iso: str


def sanitize_handle(raw: object) -> Optional[str]:
    """Handles reach captions and URLs; anything outside Instagram's alphabet is dropped."""
    if not isinstance(raw, str):
        return None
    cleaned = HANDLE_SANITIZE_RE.sub("", raw.strip().lstrip("@").lower())[:30]
    return cleaned or None


def fetch_snapshot(api_url: str) -> CitySnapshot:
    response = httpx.get(f"{api_url.rstrip('/')}/api/v1/world", timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    standings = data.get("standings") or []
    leader = standings[0] if standings else {}
    runner = standings[1] if len(standings) > 1 else {}
    climbers = [s for s in standings if int((s.get("movement") or {}).get("rankDelta", 0)) > 0]
    climber = max(climbers, key=lambda s: int(s["movement"]["rankDelta"]), default={})
    return CitySnapshot(
        total_homes=int(data.get("totals", {}).get("properties", 0)),
        leader_handle=sanitize_handle(leader.get("fandomHandle")),
        leader_fans=int(leader.get("fans", 0)),
        runner_up_handle=sanitize_handle(runner.get("fandomHandle")),
        runner_up_fans=int(runner.get("fans", 0)),
        climber_handle=sanitize_handle(climber.get("fandomHandle")),
        climber_rank=int(climber.get("rankPosition", 0)),
        climber_delta=int((climber.get("movement") or {}).get("rankDelta", 0)),
        captured_at_iso=datetime.now(timezone.utc).isoformat(),
    )


def compose_caption(snapshot: CitySnapshot) -> str:
    if snapshot.leader_handle is None:
        rivalry = "The planet was just born. The very first home could be yours."
    elif snapshot.runner_up_handle:
        gap = snapshot.leader_fans - snapshot.runner_up_fans
        rivalry = (
            f"🔥 @{snapshot.leader_handle} is #1 in the global ranking with {snapshot.leader_fans} fans, "
            f"{gap} ahead of @{snapshot.runner_up_handle}. Are you letting that happen?"
        )
    else:
        rivalry = f"👑 @{snapshot.leader_handle} rules the planet with {snapshot.leader_fans} fans."

    climb = (
        f"\n📈 @{snapshot.climber_handle} just climbed {snapshot.climber_delta} spots to #{snapshot.climber_rank}."
        if snapshot.climber_handle and snapshot.climber_handle != snapshot.leader_handle
        else ""
    )
    return (
        f"🏙️ Fanation already has {snapshot.total_homes} homes built by fans.\n\n"
        f"{rivalry}{climb}\n\n"
        "👇 Comment your idol's @ to move in next to them + your $FANT pack (packs halve as the planet grows).\n"
        "Anyone can be an idol: get fans and your home grows into a tower.\n\n"
        "#FanationClub #FandomRanking #Fandom #fanation"
    )


async def render_take(frontend_url: str, snapshot: CitySnapshot, out_dir: Path, seconds: float, fps: int) -> Path:
    """Deterministic capture: the page renders exactly frame t on request, so no frame drops."""
    if shutil.which("ffmpeg") is None:
        raise RenderError("ffmpeg not found on PATH.")
    from playwright.async_api import async_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    slug = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    frames_dir = out_dir / f"frames_{slug}"
    frames_dir.mkdir()
    mp4_path = out_dir / f"fanation_take_{slug}.mp4"
    focus = f"&focus={snapshot.leader_handle}" if snapshot.leader_handle else ""
    url = f"{frontend_url.rstrip('/')}/?cinematic=1&capture=1{focus}"
    total_frames = max(1, int(seconds * fps))

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                channel=os.environ.get("FANATION_AGENT_BROWSER_CHANNEL", "chrome"),
                headless=True,
                args=["--ignore-gpu-blocklist", "--enable-webgl"],
            )
            try:
                page = await browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
                await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                await page.wait_for_function("window.__fanationCinematic && window.__fanationCinematic.ready", timeout=60_000)
                started = time.monotonic()
                for i in range(total_frames):
                    await page.evaluate("t => window.__fanationCinematic.renderFrame(t)", i / fps)
                    await page.screenshot(path=str(frames_dir / f"frame_{i:05d}.jpg"), type="jpeg", quality=92)
                log("frames_captured", frames=total_frames, seconds=round(time.monotonic() - started, 1))
            finally:
                await browser.close()

        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-framerate", str(fps),
                "-i", str(frames_dir / "frame_%05d.jpg"),
                # JPEG frames are full-range; social platforms expect limited-range BT.709.
                "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p",
                "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                "-c:v", "libx264", "-crf", "20", "-preset", "medium",
                "-movflags", "+faststart",
                str(mp4_path),
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RenderError(f"ffmpeg failed: {exc.stderr.decode(errors='replace')[:400]}") from exc
    except Exception as exc:  # Playwright raises several unrelated types; all mean "no video".
        raise RenderError(f"capture failed: {exc}") from exc
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)

    return mp4_path


def publish_instagram_reel(video: Path, caption: str, token: str, ig_user_id: str) -> str:
    """Resumable Reels upload: create container → upload bytes → wait FINISHED → publish.
    Needs the instagram_business_content_publish permission on the token."""
    auth = {"access_token": token}
    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        created = client.post(
            f"{GRAPH_BASE}/{ig_user_id}/media",
            params=auth,
            data={"media_type": "REELS", "upload_type": "resumable", "caption": caption},
        )
        if created.status_code >= 400:
            raise PublishError(f"instagram container HTTP {created.status_code}: {created.text[:300]}")
        container = created.json()
        container_id, upload_uri = container.get("id"), container.get("uri")
        if not container_id or not upload_uri:
            raise PublishError("instagram container response missing id/uri")

        size = video.stat().st_size
        uploaded = client.post(
            upload_uri,
            headers={"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size)},
            content=video.read_bytes(),
        )
        if uploaded.status_code >= 400:
            raise PublishError(f"instagram upload HTTP {uploaded.status_code}: {uploaded.text[:300]}")

        deadline = time.monotonic() + 300
        while True:
            status = client.get(f"{GRAPH_BASE}/{container_id}", params={**auth, "fields": "status_code"}).json().get("status_code")
            if status == "FINISHED":
                break
            if status in ("ERROR", "EXPIRED") or time.monotonic() > deadline:
                raise PublishError(f"instagram container ended as {status}")
            time.sleep(5)

        published = client.post(f"{GRAPH_BASE}/{ig_user_id}/media_publish", params=auth, data={"creation_id": container_id})
        if published.status_code >= 400:
            raise PublishError(f"instagram publish HTTP {published.status_code}: {published.text[:300]}")
        return str(published.json().get("id"))


def publish_tiktok(video: Path, caption: str, token: str) -> str:
    """Direct Post, single chunk. Unaudited TikTok apps may only post with SELF_ONLY privacy."""
    size = video.stat().st_size
    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        init = client.post(
            TIKTOK_INIT_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
            json={
                "post_info": {
                    "title": caption[:2200],
                    "privacy_level": os.environ.get("TIKTOK_PRIVACY_LEVEL", "SELF_ONLY"),
                    "disable_comment": False,
                    "disable_duet": False,
                    "disable_stitch": False,
                },
                "source_info": {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": size, "total_chunk_count": 1},
            },
        )
        body = init.json() if init.content else {}
        data = body.get("data") or {}
        if init.status_code >= 400 or not data.get("upload_url"):
            raise PublishError(f"tiktok init HTTP {init.status_code}: {json.dumps(body.get('error', body))[:300]}")
        put = client.put(
            data["upload_url"],
            headers={"Content-Type": "video/mp4", "Content-Range": f"bytes 0-{size - 1}/{size}"},
            content=video.read_bytes(),
        )
        if put.status_code >= 400:
            raise PublishError(f"tiktok upload HTTP {put.status_code}: {put.text[:300]}")
        return str(data.get("publish_id"))


def publish(video: Path, caption: str, dry_run: bool) -> dict[str, Optional[str]]:
    receipt: dict[str, Optional[str]] = {"instagram_media_id": None, "tiktok_publish_id": None}
    ig_token = os.environ.get("FANATION_IG_ACCESS_TOKEN")
    ig_user = os.environ.get("FANATION_IG_USER_ID") or "me"
    tt_token = os.environ.get("TIKTOK_ACCESS_TOKEN")

    if dry_run or not ig_token:
        log("instagram_skipped", reason="dry-run" if dry_run else "FANATION_IG_ACCESS_TOKEN not set")
    else:
        try:
            receipt["instagram_media_id"] = publish_instagram_reel(video, caption, ig_token, ig_user)
            log("instagram_published", media_id=receipt["instagram_media_id"])
        except (PublishError, httpx.HTTPError) as exc:
            log("instagram_publish_failed", logging.ERROR, message=str(exc))

    if dry_run or not tt_token:
        log("tiktok_skipped", reason="dry-run" if dry_run else "TIKTOK_ACCESS_TOKEN not set")
    else:
        try:
            receipt["tiktok_publish_id"] = publish_tiktok(video, caption, tt_token)
            log("tiktok_published", publish_id=receipt["tiktok_publish_id"])
        except (PublishError, httpx.HTTPError) as exc:
            log("tiktok_publish_failed", logging.ERROR, message=str(exc))
    return receipt


async def run_cycle(args: argparse.Namespace) -> None:
    snapshot = fetch_snapshot(args.api_url)
    log("city_snapshot", **asdict(snapshot))
    caption = compose_caption(snapshot)
    video = await render_take(args.frontend_url, snapshot, Path(args.render_dir), args.seconds, args.fps)
    log("video_rendered", path=str(video), bytes=video.stat().st_size)
    receipt = publish(video, caption, args.dry_run)
    manifest = video.with_suffix(".json")
    manifest.write_text(
        json.dumps({"video": video.name, "caption": caption, "snapshot": asdict(snapshot), "published": receipt}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log("cycle_complete", manifest=str(manifest))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fanation Club media agent")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="run a single cycle (default)")
    mode.add_argument("--every-minutes", type=int, help="run forever, one cycle every N minutes")
    parser.add_argument("--dry-run", action="store_true", help="render but never publish")
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--api-url", default=os.environ.get("FANATION_API_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--frontend-url", default=os.environ.get("FANATION_FRONTEND_URL", "http://127.0.0.1:5173"))
    parser.add_argument("--render-dir", default=os.environ.get("FANATION_RENDER_DIR", "renders"))
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    if not args.every_minutes:
        try:
            await run_cycle(args)
            return 0
        except (RenderError, httpx.HTTPError) as exc:
            log("cycle_failed", logging.ERROR, message=str(exc))
            return 1
    interval = max(1, args.every_minutes) * 60
    while True:
        try:
            await run_cycle(args)
        except (RenderError, httpx.HTTPError) as exc:
            log("cycle_failed", logging.ERROR, message=str(exc))
        await asyncio.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
