"""Opt-in, offline browser verification of the local frontend and real painter input."""

import argparse
import contextlib
import hashlib
import json
import math
import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

import anyio
import httpx
from playwright.async_api import Browser, BrowserContext, Page, Route

from app.browser import get_browser, shutdown_playwright
from app.config import Config
from app.const import CONFIG_FILE
from app.exception import PaintRequestFailed
from app.log import logger
from app.schemas.coords import WplacePixelCoords
from app.wplace.page import CANVAS_ZOOM, UserContext, WplacePage
from app.wplace.page.page import CANVAS_PX_PER_PIXEL
from app.wplace.paint import Pixel, plan_space_drag_strokes


def validate_preview_url(value: str) -> str:
    url = urlsplit(value)
    if (
        url.scheme != "http"
        or url.hostname not in {"127.0.0.1", "localhost"}
        or url.username is not None
        or url.password is not None
        or url.path not in {"", "/"}
        or url.query
        or url.fragment
    ):
        raise ValueError("The smoke target must be an HTTP loopback preview origin")
    if url.port is not None and not 0 < url.port < 65536:
        raise ValueError("Invalid preview port")
    return value.rstrip("/")


class LocalContext:
    """Own a disposable context while redirecting only the painter's entry navigation."""

    def __init__(self, context: BrowserContext) -> None:
        self.context = context
        self.log = logger

    @contextlib.asynccontextmanager
    async def new_page(self) -> AsyncGenerator[Page]:
        page = await self.context.new_page()
        try:
            yield page
        finally:
            with anyio.CancelScope(shield=True):
                await page.close()


def configuration_hash() -> str | None:
    return hashlib.sha256(CONFIG_FILE.read_bytes()).hexdigest() if CONFIG_FILE.exists() else None


async def snapshot(page: Page) -> dict[str, Any]:
    return await page.evaluate("() => window.wplacePreview.snapshot()")


async def isolated_context(browser: Browser, base_url: str, blocked: list[str]) -> BrowserContext:
    context = await browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")

    async def local_only(route: Route) -> None:
        request = route.request
        if request.url == "https://wplace.live/" and request.is_navigation_request():
            # Fulfill locally, before any external connection. WplacePage.create stays unchanged.
            await route.fulfill(status=302, headers={"Location": base_url + "/"})
        elif request.url.startswith(base_url + "/") and request.method in {"GET", "HEAD"}:
            await route.continue_()
        else:
            blocked.append(f"{request.method} {urlsplit(request.url).netloc}")
            await route.abort()

    await context.route("**/*", local_only)
    await context.add_init_script(
        f"if (location.origin === {json.dumps(base_url)}) {{"
        "localStorage.setItem('wplace-local-preview-v1', JSON.stringify({demo:true}));"
        "localStorage.setItem('show-all-colors','false'); }"
    )
    return context


def bridge_data(base_url: str, key: str, pixels: list[Pixel]) -> list[Any]:
    anchor = WplacePixelCoords(1037, 704, 400, 600)
    first, last = anchor.to_lat_lon(), anchor.offset(1, 1).to_lat_lon()
    center = [(first.lat + last.lat) / 2, (first.lon + last.lon) / 2]
    batch = []
    for pixel in pixels:
        point = anchor.offset(pixel.x, pixel.y)
        tile, offset = point.as_dtuple()
        batch.append([tile, offset, pixel.color])
    exports = [[name, base_url + "/bridge.mjs"] for name in ["painter", "worker", "season", "patches"]]
    return [key, batch, exports, center, CANVAS_ZOOM]


async def verify_painter(browser: Browser, base_url: str, output: Path, report: dict[str, Any]) -> None:
    blocked: list[str] = []
    errors: list[str] = []
    context = await isolated_context(browser, base_url, blocked)
    context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
    try:
        pixels = [Pixel(0, 0, 7), Pixel(1, 0, 7), Pixel(2, 1, 7), Pixel(2, 2, 7)]
        expected = [[1037400 + p.x, 704600 + p.y, p.color] for p in pixels]
        user_context = cast("UserContext", LocalContext(context))
        async with WplacePage.create(user_context, bridge_data(base_url, "local-smoke", pixels)) as painter:
            assert painter.page.url.startswith(base_url + "/")
            initial = await snapshot(painter.page)
            assert math.isclose(initial["scale"], CANVAS_PX_PER_PIXEL, abs_tol=1e-8)
            async with painter.open_paint_panel() as panel:
                await panel.select_color(7)
                for stroke in plan_space_drag_strokes(pixels):
                    await painter.paint_space_drag([(p.x, p.y) for p in stroke])
                selected = await snapshot(painter.page)
                assert sorted(selected["pending"]) == sorted(expected), selected["pending"]
                await painter.page.screenshot(path=str(output / "script-selected.png"))
                await panel.submit()
                painter.ensure_submit_succeeded()
                committed = await snapshot(painter.page)
                assert committed["pending"] == []
                assert sorted(committed["pixels"]) == sorted(expected)
                assert math.floor(committed["charges"]) == 46
                assert await painter.page.evaluate("() => window.wplacePreview.lastBridgeBatch") == expected
                # Verify the rendered overlay contains the actual red pixels, not only model state.
                await painter.page.wait_for_function(
                    "() => {const c=document.querySelector('#map'), d=c.getContext('2d');"
                    "const p=d.getImageData(c.width/2,c.height/2,1,1).data; return p[0]===237 && p[1]===28;}"
                )
            await painter.page.screenshot(path=str(output / "script-submitted.png"))
            # Do not reset the saved state on reload: remove the initial fixture from a fresh page.
            saved = await painter.page.evaluate("() => localStorage.getItem('wplace-local-preview-v1')")
            report["script_pixels"] = committed["pixels"]
            report["submit_success"] = True
            report["visible_pixel_readback"] = True
            report["storage_payload"] = json.loads(saved)["pixels"]
        async with (
            WplacePage.create(user_context, bridge_data(base_url, "local-mismatch", [Pixel(0, 0, 7)])) as painter,
            painter.open_paint_panel() as panel,
        ):
            await panel.select_color(19)
            await painter.click_current_pixel()
            try:
                await panel.submit()
            except PaintRequestFailed:
                report["mismatched_bridge_rejected"] = True
            else:
                raise AssertionError("A mismatched visible selection was accepted")
            assert (await snapshot(painter.page))["totalPainted"] == 0
    finally:
        await context.close()
    assert not blocked, blocked
    assert not errors, errors
    report["unexpected_external_requests"] = blocked
    report["page_errors"] = errors


async def verify_surfaces(browser: Browser, base_url: str, output: Path, report: dict[str, Any]) -> None:
    context = await browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    errors: list[str] = []
    blocked: list[str] = []

    async def local_only(route: Route) -> None:
        if route.request.url.startswith(base_url + "/"):
            await route.continue_()
        else:
            blocked.append(route.request.url)
            await route.abort()

    await context.route("**/*", local_only)
    try:
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto(base_url)
        await page.wait_for_function("() => window.wplacePreview?.ready")
        await page.screenshot(path=str(output / "desktop.png"))
        await page.locator("#paint").click()
        await page.screenshot(path=str(output / "login.png"))
        await page.locator("#enter-demo").click()
        await page.locator("#color-19").click()
        await page.mouse.click(720, 400)
        selected = (await snapshot(page))["pending"]
        assert len(selected) == 1
        await page.locator("#undo").click()
        assert (await snapshot(page))["pending"] == []
        await page.mouse.move(720, 400)
        await page.keyboard.down("Space")
        await page.evaluate("() => window.dispatchEvent(new Event('blur'))")
        before_blur = (await snapshot(page))["pending"]
        assert len(before_blur) == 1
        await page.mouse.move(760, 400)
        await page.keyboard.up("Space")
        assert (await snapshot(page))["pending"] == before_blur
        await page.locator("#clear").click()
        report["blur_releases_stroke"] = True
        await page.mouse.click(720, 400)
        await page.locator("#submit").click()
        await page.wait_for_function("() => window.wplacePreview.snapshot().totalPainted===1")
        await page.reload()
        await page.wait_for_function("() => window.wplacePreview?.ready")
        assert (await snapshot(page))["pixels"] == selected
        report["refresh_persistence"] = True
        before_pan = (await snapshot(page))["location"]
        await page.mouse.move(720, 350)
        await page.mouse.down()
        await page.mouse.move(820, 350, steps=8)
        await page.mouse.up()
        await page.wait_for_function(
            "lng => Math.abs(window.wplacePreview.snapshot().location.lng-lng)>0.0001", arg=before_pan["lng"]
        )
        before_zoom = (await snapshot(page))["location"]["zoom"]
        await page.locator("#zoom-in").click()
        await page.wait_for_function("zoom => window.wplacePreview.snapshot().location.zoom>zoom+0.9", arg=before_zoom)
        await page.locator("#my-location").click()
        report["map_pan_and_zoom"] = True
        await page.locator("#account").click()
        async with page.expect_download() as download_event:
            await page.locator("#export-json").click()
        download = await download_event.value
        await download.save_as(output / "pixels.json")
        assert json.loads((output / "pixels.json").read_text())["pixels"] == selected
        async with page.expect_download() as download_event:
            await page.locator("#export-png").click()
        await (await download_event.value).save_as(output / "pixels.png")
        report["exports"] = ["pixels.json", "pixels.png"]
        await page.locator("#close-modal").click()
        await page.locator("#search").click()
        await page.locator("#place-query").fill("48.853715, 2.348403")
        await page.locator("#search-results button").click()
        # Coordinate visits enable the external optional basemap; turn it off for remaining offline QA.
        await page.locator("#layers").click()
        await page.locator("#streets-toggle").uncheck()
        await page.locator("#opacity-presets [data-opacity='50']").click()
        assert await page.locator("#opacity-value").inner_text() == "50%"
        await page.locator("#close-layers").click()
        await page.locator("#leaderboard").click()
        await page.get_by_role("tab", name="Players").click()
        assert "You" in await page.locator(".ranking").inner_text()
        await page.locator("#close-modal").click()
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.locator("#paint").click()
        await page.locator("#all-colors").click()
        assert await page.locator(".color").count() == 64
        assert await page.evaluate("() => document.documentElement.scrollWidth === innerWidth")
        await page.locator("#color-63").click()
        await page.screenshot(path=str(output / "mobile.png"))
        await page.locator("#close-paint").click()
        await page.locator("#search").click()
        await page.screenshot(path=str(output / "mobile-search.png"))
        report["mobile_viewport"] = [390, 844]
        report["surface_checks"] = ["login", "undo", "submit", "search", "leaderboard", "opacity", "mobile palette"]
        await context.route(
            base_url + "/api/health",
            lambda route: route.fulfill(json={"app": "wplace-local-preview", "mode": "local-only", "references": {}}),
        )
        await page.goto(base_url)
        await page.wait_for_function("() => window.wplacePreview?.ready")
        assert (await snapshot(page))["reference"] is False
        await page.locator("#paint").click()
        await page.locator("#color-7").click()
        await page.mouse.click(190, 190)
        assert len((await snapshot(page))["pending"]) == 1
        await page.screenshot(path=str(output / "offline-fallback.png"))
        report["offline_without_reference"] = True
    finally:
        await context.close()
    assert not errors, errors
    # External basemap requests are blocked intentionally; no production write is allowed.
    assert all(url.startswith("https://tile.openstreetmap.org/") for url in blocked), blocked
    report["optional_map_requests_blocked"] = len(blocked)


async def run(base_url: str, output: Path) -> None:
    base_url = validate_preview_url(base_url)
    async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
        response = await client.get(base_url + "/api/health")
        response.raise_for_status()
        assert response.json()["app"] == "wplace-local-preview"
    await anyio.Path(output).mkdir(parents=True, exist_ok=True)
    before = configuration_hash()
    report: dict[str, Any] = {"target": base_url, "mode": "local-only", "status": "running"}
    # Process-local test dependencies; never read or save real account configuration.
    config = SimpleNamespace(browser="chromium", proxy=None, log_level="INFO")
    with (
        patch.object(Config, "load", return_value=config),
        patch("app.browser.manager.setup_playwright_env"),
        patch(
            "app.browser.manager.install_playwright_browser",
            new=AsyncMock(side_effect=RuntimeError("Install Chromium with uv run playwright install chromium first")),
        ),
    ):
        try:
            async with get_browser(headless=True) as browser:
                await verify_painter(browser, base_url, output, report)
                await verify_surfaces(browser, base_url, output, report)
        except Exception as error:
            report["status"] = "failed"
            report["error"] = str(error)
            raise
        finally:
            with anyio.CancelScope(shield=True):
                await shutdown_playwright()
            report["configuration_unchanged"] = before == configuration_hash()
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    assert report["configuration_unchanged"]
    report["status"] = "passed"
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    logger.success("Frontend smoke passed; evidence: {}", output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5173")
    parser.add_argument("--output-dir", type=Path, default=Path(".local/frontend-smoke"))
    args = parser.parse_args()
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    anyio.run(run, args.url, args.output_dir)


if __name__ == "__main__":
    main()
