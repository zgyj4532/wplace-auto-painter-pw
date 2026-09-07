# WPlace frontend reconstruction

## Scope and method

Build a runnable local frontend based on the public https://wplace.live/ interface, and exercise the existing painter's browser input against it. Keep production painting, account configuration, credentials, purchases and updater behavior unchanged.

The requested online skill was found with `npx --yes skills find 'reverse engineering'`: [zhaoxuya520/reverse-skill, reverse-engineering](https://skills.sh/zhaoxuya520/reverse-skill/reverse-engineering) (approximately 1K installs; source repository reported 34,950 stars on 2026-09-08). Its own routing directs frontend work to [js-reverse/SKILL.md](https://github.com/zhaoxuya520/reverse-skill/blob/main/skills/js-reverse/SKILL.md). Apply its Observe, Capture, Rebuild, Patch and evidence-based validation stages to the public UI. Use the available Playwright MCP, Node and Python tools; binary analysis, authentication hooks and client-wide MCP installation are unnecessary for this task. Third-party skill examples do not grant authorization.

## Observed evidence, 2026-09-08

- Public version displayed in Info: v1.6.12. Svelte frontend, MapLibre map, OpenFreeMap / OpenStreetMap geography.
- At 1440 × 900: Info at (8, 8), 32px diameter; zoom buttons below. Log in at top right, then 40px Leaderboard and Search buttons. Paint centered 12px above the bottom, approximately 137 × 56px, with a 32px radius. Location button at bottom right.
- Font: Geist; wordmark: Pixelify Sans. Winter theme primary `oklch(0.5686 0.255 257.57)`, content `oklch(0.41886 0.053 255.824)`, button background `oklch(0.97466 0.011 259.822)`.
- Anonymous Paint opens a login dialog. No real authentication or painting was performed. Reconstructed drawing/account/charge behavior will therefore be explicitly local demo behavior, grounded in the repository contracts and public help text rather than claimed authenticated live evidence.
- Help explicitly describes holding SPACE while moving the cursor. Search has an input and recent locations. Leaderboard has Regions, Countries, Players and Alliances tabs plus Visit actions.
- Public map starts near Paris (48.853715, 2.348403), zoom 14.5. Observed public artwork request: `GET https://backend.wplace.live/files/s0/tiles/1037/704.png`. Runtime reference material belongs in ignored `.local/`, not source control.
- Existing script contracts: `PAINT_BTN_SELECTOR`, `#color-{id}`, paint panel close selector, `CANVAS_ZOOM=15`, `CANVAS_PX_PER_PIXEL=7.65`, Space stroke input, and explicit batch-level `submit-success`. Keep production calibration unchanged. Local preview follows that calibration to enable input regression checks; it is not a new live calibration measurement.
- Screenshots and downloaded skill source are retained under `.local/`. Do not retain account payloads or raw request headers in evidence.

## Implementation plan

1. Add an isolated, dependency-free browser frontend in `frontend/` and a loopback-only Node static server. No application configuration is loaded. Optional public reference artwork is cached only in `.local/frontend/`.
2. Reconstruct the full-window map, floating controls, winter theme, login/info/search/leaderboard dialogs, palette and bottom paint tray. Add mobile layouts, accessible names, focus handling and keyboard controls.
3. Implement local pixel selection, Space strokes, erasing, undo/clear, atomic submit, a 30-second charge clock, local persistence, coordinate navigation, zoom/pan, pixel opacity, and PNG/JSON export. Include a clearly labeled local demo entry; never use a real identity provider or production write endpoint.
4. Reuse the project's color IDs and coordinate formulas. Add a local bridge fixture and an opt-in smoke runner that invokes the actual `WplacePage`, `PaintPanel`, and injected `paint_btn.js` against the loopback page with local module exports. Verify visible pixel results, submitted payload and batch success.
5. Validate frontend state/server logic, desktop and mobile behavior, offline fallback, refresh persistence and the real script integration. Run frozen uv sync, Ruff, format, cross-platform ty and pytest. Start the review service, read back its health and UI, and provide its URL.

## Acceptance boundaries

The deliverable is an interactive local reconstruction with script integration evidence. Public map/artwork is reference material, demo rankings are sample data, and all painting is local to the browser. Real Google login, shared multiplayer state, paid purchases, Cloudflare challenges and authenticated production behavior are outside this reconstruction. No production success claim follows from local tests.
