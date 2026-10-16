"""Screenshot of the live $FANT tokenomics panel."""

import asyncio
from pathlib import Path

from playwright.async_api import async_playwright


async def main() -> None:
    out = Path("renders/screens/tokenomics")
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", args=["--use-angle=metal", "--enable-gpu"])
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        await page.goto("http://127.0.0.1:5173/", wait_until="domcontentloaded")
        await page.wait_for_timeout(7000)
        await page.get_by_role("button", name="$FANT").first.click()
        await page.wait_for_timeout(600)
        await page.screenshot(path=str(out / "panel.png"))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
