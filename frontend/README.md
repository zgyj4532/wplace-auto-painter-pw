# Local WPlace frontend

An interactive reconstruction for reviewing the WPlace UI and exercising this repository's painter input without a real account. It uses MapLibre for the map and gestures, Lucide for icons, and the existing Python dependency's color palette. The downloaded `data/js_chunks` files are inspected as reference; no production bundles are copied into source or executed by this preview.

## Start

Requires Node.js 20 or newer. From the repository root:

```powershell
npm --prefix frontend ci
npm --prefix frontend run reference
```

Open **http://127.0.0.1:5173/**. `reference` downloads one publicly observed Paris artwork tile and two fonts into ignored `.local/frontend/`, with a finite timeout. Subsequent starts use the cache. For a completely offline start, use `npm --prefix frontend start`; an empty drawable canvas and system fonts are available without cached reference material. Optional Street map reads OpenStreetMap raster tiles.

For another port: `node frontend/server.mjs --port 5174`. The server binds only to loopback and serves frontend assets; it never serves `data/`, credentials, profiles or other repository files.

## Review

- Click **Paint → Enter local demo**, choose a color and click the map. Hold **Space** while moving to draw continuously. Drag to pan; scroll or use +/− to zoom.
- Use Undo, Clear selection, the transparent color, Show all colors and Paint to exercise the selection and submit flow. A charge recovers every 30 seconds.
- Refresh to check saved pixels. The account button offers instant demo refill and PNG/JSON export.
- Search supports six sample cities and arbitrary `latitude, longitude`. Leaderboard tabs use explicitly labeled sample rankings. Info and keyboard shortcuts explain the local flow.
- Test the responsive palette and dialogs at a mobile width. No account login, purchase or live paint request is made.

## Validation

```powershell
npm --prefix frontend test
uv run python -m scripts.smoke_frontend --url http://127.0.0.1:5173
```

The opt-in smoke runner uses an isolated browser context, blocks external requests, calls the actual `WplacePage`/`PaintPanel` methods and unchanged injected submit bridge, and writes its evidence under `.local/frontend-smoke/`. It does not use any real account. It is distinct from an authenticated production test.

See [the reconstruction plan](../docs/frontend-reconstruction-plan.md) for observations and scope, and [verification evidence](../docs/frontend-verification.md) for current results.
