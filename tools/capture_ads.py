"""Screenshots of the partner-ad surfaces: the city zoomed in on the sky, and the Advertise modal."""

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright


async def main(url: str, out: Path, wait_ms: int) -> None:
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", args=["--use-angle=metal", "--enable-gpu"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(wait_ms)
        # Zoom in a little over the middle of the city so the zeppelins read.
        await page.mouse.move(720, 420)
        for _ in range(3):
            await page.mouse.wheel(0, -240)
            await page.wait_for_timeout(250)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(out / "sky.png"))
        await page.get_by_role("button", name="Advertise").first.click()
        await page.wait_for_timeout(600)
        await page.screenshot(path=str(out / "advertise.png"))
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    parser.add_argument("--out", default="renders/screens/ads")
    parser.add_argument("--wait-ms", type=int, default=9000)
    args = parser.parse_args()
    asyncio.run(main(args.url, Path(args.out), args.wait_ms))
