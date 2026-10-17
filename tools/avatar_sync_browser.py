#!/usr/bin/env python3
"""
Fill AvatarService cache when Instagram’s server-side HTML has no og:image.

Same product path as Muse refresh + `npm run avatar:seed`:
  Playwright Chrome opens the public profile → CDN URL → avatar-seed → data/avatars.

  agent/.venv/bin/python tools/avatar_sync_browser.py
  agent/.venv/bin/python tools/avatar_sync_browser.py tomkray bobmarley
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8787"
HANDLE_RE = re.compile(r"^[a-z0-9._]{1,30}$")


def decode_entities(value: str) -> str:
    return (
        value.replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def known_handles() -> list[str]:
    with urllib.request.urlopen(f"{API}/api/v1/world", timeout=20) as response:
        world = json.load(response)
    found: set[str] = set()
    for standing in world.get("standings") or []:
        h = (standing.get("fandomHandle") or "").lower()
        if HANDLE_RE.match(h):
            found.add(h)
    for event in world.get("activity") or []:
        h = (event.get("authorUsername") or "").lower()
        if HANDLE_RE.match(h):
            found.add(h)
    for prop in world.get("properties") or []:
        for key in ("minterHandle", "ownerHandle", "fandomHandle"):
            h = (prop.get(key) or "").lower()
            if HANDLE_RE.match(h):
                found.add(h)
    return sorted(found)


def already_cached(handle: str) -> bool:
    try:
        req = urllib.request.Request(f"{API}/api/v1/avatars/{handle}")
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status == 200
    except Exception:
        return False


def picture_and_verified(page, handle: str) -> tuple[str | None, bool]:
    page.goto(f"https://www.instagram.com/{handle}/", wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_timeout(900)
    found = page.evaluate(
        """() => {
          const og = document.querySelector('meta[property="og:image"]')?.content;
          const byAlt = [...document.querySelectorAll('img')].find((i) => /profile picture/i.test(i.alt || ''));
          const header = document.querySelector('header img');
          const url = byAlt?.currentSrc || byAlt?.src || header?.currentSrc || header?.src || og || null;
          const root = document.querySelector('header') || document.body;
          const badge = !!root.querySelector('[aria-label="Verified"], [title="Verified"]');
          const embedded = /"is_verified"\\s*:\\s*true/.test(document.documentElement.innerHTML);
          return { url, verified: badge || embedded };
        }"""
    )
    url = None
    raw = (found or {}).get("url") if isinstance(found, dict) else None
    if raw:
        decoded = decode_entities(str(raw).strip())
        if decoded.startswith("https://") and ("cdninstagram.com" in decoded or "fbcdn.net" in decoded):
            url = decoded
    verified = bool((found or {}).get("verified")) if isinstance(found, dict) else False
    return url, verified


def seed(handle: str, url: str) -> bool:
    result = subprocess.run(
        ["npm", "run", "avatar:seed", "--", handle, url],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode == 0


def main() -> int:
    args = [a.strip().lower().lstrip("@") for a in sys.argv[1:] if HANDLE_RE.match(a.strip().lower().lstrip("@"))]
    handles = args or known_handles()
    if not handles:
        print("No handles to sync.", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    ok = 0
    miss = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        try:
            for handle in handles:
                url, verified = picture_and_verified(page, handle)
                flag = "--verified" if verified else "--not-verified"
                if not already_cached(handle):
                    if not url or not seed(handle, url):
                        print(f"✗ @{handle} no portrait", file=sys.stderr)
                        miss += 1
                        continue
                    print(f"✓ @{handle} seeded via browser CDN")
                else:
                    print(f"· @{handle} already cached")
                marked = subprocess.run(
                    ["npm", "run", "avatar:seed", "--", handle, flag],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                )
                sys.stdout.write(marked.stdout)
                if marked.returncode != 0:
                    sys.stderr.write(marked.stderr)
                    print(f"✗ @{handle} verified flag failed", file=sys.stderr)
                    miss += 1
                    continue
                ok += 1
        finally:
            browser.close()

    print(f"done ok={ok} missing={miss}")
    return 0 if miss == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
