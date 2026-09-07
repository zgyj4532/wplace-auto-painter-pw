# Frontend verification — 2026-09-08

## Delivered behavior

The local frontend reconstructs the public WPlace map and floating controls, winter palette, login-shaped demo entry, drawing tray, search, leaderboard, information and keyboard dialogs. MapLibre owns the map projection, gestures and street tiles; Lucide supplies icons. The site's cached `data/js_chunks` were used to verify color order, palette layout, Space interpolation and cancellation behavior. No cached production bundle is committed or executed.

The preview supports 64 local colors, transparent pixels, click/Space drawing, undo/clear, local atomic submission, charge recovery, persistence, coordinate navigation, zoom/pan, opacity and PNG/JSON export. Mobile palettes use a scrolling 28dvh area, as indicated by the cached frontend module. Public Paris artwork and fonts are optional runtime reference assets under ignored `.local/frontend/`.

## Painter regression found by the reconstruction

The original `WplacePage.paint_space_drag` emitted 2–4 interpolated mouse events between adjacent target centers while Space was held. A diagonal path with four target pixels selected five cells in the reconstructed interaction: the extra cell was `(1037401, 704601)`. The cached `B0o22j3x.js` performs its own interpolation from each mouse event to pixel coordinates, so the extra pointer events can cross a side cell before the diagonal endpoint.

The permanent regression test failed before the fix. Each move while Space is held now goes directly to the next adjacent pixel center (`steps=1`), allowing the site's own interpolation to handle the stroke. Initial approach, delays, ownership and cancellation-safe Space release remain in place. `CANVAS_ZOOM` and `CANVAS_PX_PER_PIXEL` are unchanged.

The opt-in smoke runner calls the actual `WplacePage.create`, `PaintPanel`, stroke planner, pointer methods and unchanged `paint_btn.js`. It redirects the initial navigation locally before connecting externally and supplies local module exports for submit. The bridge independently compares the payload to the visible queued selection before committing.

## Evidence

`uv run python -m scripts.smoke_frontend --url http://127.0.0.1:5173` passed. Its machine-readable report is `.local/frontend-smoke/report.json`:

- Four intended red pixels selected, submitted and read back: `(1037400,704600)`, `(1037401,704600)`, `(1037402,704601)`, `(1037402,704602)`.
- Actual canvas pixel RGBA readback matches red; `submit-success` is observed; charges decrease from 50 to 46.
- A mismatched selection/payload is rejected without painting. The expected `submit-error` console log belongs to this negative test.
- No unexpected external request and no JavaScript page error in the painter integration.
- Refresh persistence, blur cleanup, undo, pan/zoom, search, sample ranking tabs, opacity, and the 390 × 844 mobile palette pass.
- JSON export contains the selected pixel. PNG export was independently opened with Pillow: 1 × 1, RGBA `(64,147,228,255)`.
- A separate browser run without any cached reference assets remains drawable. Optional OpenStreetMap requests are deliberately blocked by the surface smoke test, verifying its unavailable-map behavior.
- A separate read-only browser check enabled the London street layer and received HTTP 200 with `image/png` from `tile.openstreetmap.org`; this is separate from the deterministic offline smoke run.
- Configuration SHA-256 matches the pre-task baseline. The original executable, `_internal/`, manifest, account data and JS chunk cache were excluded from commits.

Browser screenshots were opened for visual inspection: `.local/frontend-smoke/desktop.png`, `login.png`, `script-selected.png`, `script-submitted.png`, `mobile.png`, `mobile-search.png`, and `offline-fallback.png`.

## Repeatable checks

```powershell
uv sync --frozen
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run check
uv run ruff check .
uv run ruff format --check .
uv run ty check --python-platform all
uv run python -m pytest tests
uv run python -m scripts.smoke_frontend --url http://127.0.0.1:5173
```

Node state/server tests: 8. Python tests: 25, including the diagonal-input regression and loopback target validation. These are local checks, not remote CI or authenticated WPlace UAT. No packaging files or Python dependencies changed; `uv.lock` is unchanged.

## Review service and scope

Start with `npm --prefix frontend run reference`, then visit **http://127.0.0.1:5173/** and select **Paint → Enter local demo**. The server listens only on loopback. `GET /api/health` identifies `wplace-local-preview` and reports available cached reference assets.

All painting and accounts in this preview are local simulations. Rankings are sample data. The reference layer contains one cached Paris tile; other locations offer a local canvas and optional OpenStreetMap geography, not a copy of the entire live artwork database. Google login, shared multiplayer state, paid purchases, challenges and production submission were not tested or enabled. The live site may change independently of this reconstruction.

Work is committed in stages on `feat/wplace-local-frontend` and pushed to the user-confirmed `zgyj4532/wplace-auto-painter-pw` repository.
