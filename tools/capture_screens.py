"""
Visual QA: screenshots of the running app at desktop and phone sizes.

  agent/.venv/bin/python tools/capture_screens.py [--url http://127.0.0.1:5173] [--out renders/screens]
"""

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900, "scale": 2, "mobile": False},
    "phone": {"width": 390, "height": 844, "scale": 3, "mobile": True},
}


async def capture(url: str, out_dir: Path, wait_ms: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--ignore-gpu-blocklist", "--enable-webgl"])
        for name, vp in VIEWPORTS.items():
            context = await browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                device_scale_factor=vp["scale"],
                is_mobile=vp["mobile"],
                has_touch=vp["mobile"],
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_selector("canvas")
            await page.wait_for_timeout(wait_ms)
            target = out_dir / f"{name}.png"
            await page.screenshot(path=str(target))
            print(f"saved {target}")
            await context.close()
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    parser.add_argument("--out", default="renders/screens")
    parser.add_argument("--wait-ms", type=int, default=4000)
    args = parser.parse_args()
    asyncio.run(capture(args.url, Path(args.out), args.wait_ms))
