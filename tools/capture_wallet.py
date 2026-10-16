"""End-to-end check of Connect → profile wallet → selecting a home, with screenshots (demo mode)."""

import argparse
import asyncio
import json
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright


def demo_handle(api: str) -> str:
    with urllib.request.urlopen(f"{api}/api/v1/world") as response:
        world = json.load(response)
    return world["topByXp"][0]["handle"]


async def main(url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    handle = demo_handle(url.rstrip("/"))
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", args=["--use-angle=metal", "--enable-gpu"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(8000)

        await page.get_by_role("button", name="Connect").first.click()
        await page.get_by_placeholder("@your_username").fill(handle)
        await page.get_by_role("button", name="Get my code").click()
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(out / "connect.png"))
        await page.get_by_role("button", name="Demo: post the comment for me").click()
        await page.get_by_text("Verified on Instagram").wait_for(timeout=15000)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(out / "profile.png"))
        await page.get_by_role("button", name="Show").first.click()
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(out / "selected.png"))
        await browser.close()
    print(f"connected as @{handle}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    parser.add_argument("--out", default="renders/screens/wallet")
    args = parser.parse_args()
    asyncio.run(main(args.url, Path(args.out)))
