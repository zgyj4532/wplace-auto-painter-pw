import {
  PaintState,
  PARIS,
  STORAGE_KEY,
  MAX_CHARGES,
  CHARGE_MS,
  lineBetween,
  toLocation,
} from "./model.mjs";
import { PixelMap, describePixel } from "./map.mjs";

const $ = (selector) => document.querySelector(selector);
const palette = await fetch("/palette.json").then((r) => r.json());
const health = await fetch("/api/health").then((r) => r.json());
const iconNames = {
  info: "Info",
  layers: "Layers",
  leaderboard: "ChartNoAxesColumnIncreasing",
  search: "Search",
  brush: "Paintbrush",
  keyboard: "Keyboard",
  locate: "LocateFixed",
  bolt: "Zap",
  undo: "Undo2",
  redo: "Redo2",
  trash: "Trash2",
  lock: "LockKeyhole",
  eraser: "Eraser",
};
function icons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    const definition = lucide[iconNames[el.dataset.icon]];
    if (definition)
      el.replaceChildren(
        lucide.createElement(definition, {
          width: 20,
          height: 20,
          "stroke-width": 1.7,
          "aria-hidden": "true",
        }),
      );
  }
}
icons();
for (const [name, file] of [
  ["Geist", "geist.woff2"],
  ["Pixelify", "pixelify.woff2"],
]) {
  if (health.references[file]) {
    const font = new FontFace(name, `url(/reference/${file})`, {
      weight: "100 900",
    });
    font
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {});
  }
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function readText(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const saved = readStorage(STORAGE_KEY) || {};
const state = new PaintState(saved);
let demo = saved.demo === true;
let selected = Number(readText("selected-color")) || 1;
if (!palette[selected]) selected = 1;
let allColors = readText("show-all-colors") === "true";
let painting = false,
  space = false,
  submitting = false,
  pointer = null,
  previousPixel = null;
let toastTimer,
  persistenceTimer,
  searchRecent = Array.isArray(saved.recent) ? saved.recent.slice(0, 5) : [];

function validLocation(value) {
  return (
    value &&
    Number.isFinite(value.lat) &&
    Math.abs(value.lat) <= 85 &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lng) <= 180 &&
    Number.isFinite(value.zoom) &&
    value.zoom >= 2 &&
    value.zoom <= 18
  );
}
const query = new URLSearchParams(location.search);
const queryLocation = {
  lat: Number(query.get("lat")),
  lng: Number(query.get("lng")),
  zoom: Number(query.get("zoom") || 14.5),
};
const storedLocation = readStorage("location");
const start =
  query.has("lat") && query.has("lng") && validLocation(queryLocation)
    ? queryLocation
    : validLocation(storedLocation)
      ? storedLocation
      : PARIS;
const map = new PixelMap($("#map"), state, palette, start);
if (health.references["paris.png"]) await map.loadReference();
$("#attribution").textContent = map.reference
  ? "Wplace community artwork · cached reference · local edits"
  : "Local demo canvas · MapLibre";

function persist() {
  const ok = writeStorage(STORAGE_KEY, {
    ...state.serialize(),
    demo,
    recent: searchRecent,
  });
  writeStorage("location", map.location);
  if (!ok)
    toast("Browser storage is full. Export your painting to keep a copy.");
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3600);
}

function update() {
  state.recharge();
  $("#charges").textContent = `${Math.floor(state.charges)} / ${MAX_CHARGES}`;
  const seconds =
    state.charges >= MAX_CHARGES
      ? 0
      : Math.ceil(((1 - (state.charges % 1)) * CHARGE_MS) / 1000);
  $("#charge-timer").textContent = seconds
    ? `0:${String(seconds).padStart(2, "0")}`
    : "Full";
  $("#submit-label").textContent = submitting
    ? "Painting…"
    : `Paint ${state.pending.size} pixel${state.pending.size === 1 ? "" : "s"}`;
  $("#submit").disabled = !state.pending.size || submitting;
  $("#undo").disabled = !state.history.length || submitting;
  $("#clear").disabled = !state.pending.size || submitting;
  $("#account").textContent = demo
    ? `${Math.floor(state.charges)} / 50`
    : "Log in";
  $("#account").setAttribute(
    "aria-label",
    demo ? "Local demo account" : "Log in",
  );
  map.render();
}

// The expanded order is taken from the cached site's palette module.
const expandedOrder = [
  1, 2, 3, 32, 4, 5, 6, 33, 7, 34, 35, 8, 9, 10, 11, 37, 38, 39, 40, 41, 42, 12,
  13, 14, 15, 16, 17, 43, 20, 44, 18, 19, 45, 46, 21, 22, 47, 48, 49, 23, 24,
  25, 26, 27, 28, 53, 54, 55, 29, 30, 50, 56, 57, 36, 51, 31, 52, 61, 62, 63,
  58, 59, 60, 0,
];
function renderPalette() {
  $("#palette").replaceChildren();
  for (const id of allColors
    ? expandedOrder
    : [...Array.from({ length: 31 }, (_, i) => i + 1), 0]) {
    const color = palette[id],
      button = document.createElement("button");
    button.id = `color-${id}`;
    button.className = "color";
    button.title = color.name;
    button.setAttribute("aria-label", color.name);
    button.setAttribute("aria-pressed", String(id === selected));
    if (id === 0) {
      button.classList.add("eraser");
      button.innerHTML = '<span data-icon="eraser"></span>';
    } else button.style.background = color.hex;
    const rgb = color.hex
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16));
    if (rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 160)
      button.classList.add("light");
    button.addEventListener("click", () => selectColor(id));
    $("#palette").append(button);
  }
  $("#all-colors").innerHTML =
    `${allColors ? "Collapse" : "Show all colors"} <span>${allColors ? "⌃" : "⌄"}</span>`;
  $("#all-colors").setAttribute("aria-expanded", String(allColors));
  $("#color-count").textContent = allColors
    ? "64 colors · all unlocked in demo"
    : "32 colors";
  document.body.classList.toggle("all-open", allColors);
  icons($("#palette"));
  selectColor(selected);
}

function selectColor(id) {
  selected = id;
  try {
    localStorage.setItem("selected-color", String(id));
  } catch {}
  for (const button of $("#palette").children)
    button.setAttribute("aria-pressed", String(button.id === `color-${id}`));
  $("#selected-name").textContent = palette[id].name;
  $("#selected-swatch").style.background = id ? palette[id].hex : "";
  $("#selected-swatch").className = id ? "" : "eraser";
}

function openPaint() {
  if (!demo) {
    showLogin(true);
    return;
  }
  painting = true;
  map.painting = true;
  $("#paint").hidden = true;
  $("#paint-panel").hidden = false;
  $("#pixel-info").hidden = true;
  document.body.classList.add("paint-open");
  map.map.getCanvas().style.cursor = "crosshair";
  if (map.location.zoom < 13) map.jump({ ...map.location, zoom: 14.5 });
  renderPalette();
  update();
}
function closePaint() {
  releaseStroke();
  painting = false;
  map.painting = false;
  $("#paint").hidden = false;
  $("#paint-panel").hidden = true;
  document.body.classList.remove("paint-open");
  map.map.getCanvas().style.cursor = "";
  map.render();
}

function queuePixel(point, interpolate = false) {
  if (!painting || submitting || !point) return;
  state.recharge();
  const pixel = map.atPoint(point.x, point.y);
  const points =
    interpolate && previousPixel ? lineBetween(previousPixel, pixel) : [pixel];
  let added = false;
  for (const [x, y] of points) added = state.queue(x, y, selected) || added;
  if (!added && state.pending.size >= Math.floor(state.charges))
    toast("All available charges are selected. Paint to save this batch.");
  previousPixel = pixel;
  update();
}

async function submit() {
  if (submitting) throw new Error("A batch is already being submitted");
  submitting = true;
  releaseStroke();
  update();
  try {
    // Keep the action asynchronous so duplicate clicks cannot commit twice.
    await new Promise((resolve) => setTimeout(resolve, 180));
    const batch = state.submit();
    persist();
    toast(
      `${batch.length} pixel${batch.length === 1 ? "" : "s"} painted. Saved in this browser.`,
    );
    return batch;
  } finally {
    submitting = false;
    update();
  }
}

const inputCanvas = map.map.getCanvas();
inputCanvas.setAttribute("aria-label", "Interactive pixel map");
inputCanvas.addEventListener("pointermove", (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  map.hover = map.atPoint(pointer.x, pointer.y);
  if (space) queuePixel(pointer, true);
  showCoordinates(map.hover);
  map.render();
});
inputCanvas.addEventListener("pointerleave", () => {
  pointer = null;
  previousPixel = null;
  map.hover = null;
  map.render();
});
map.map.on("click", (event) => {
  if ($("#modal").open) return;
  if (painting) {
    queuePixel(event.point);
    previousPixel = null;
  } else showPixel(map.atPoint(event.point.x, event.point.y));
});
map.map.on("movestart", () => {
  $("#pixel-info").hidden = true;
});
map.onMove = () => {
  showCoordinates();
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(
    () => writeStorage("location", map.location),
    250,
  );
};
let tileWarning = false;
map.onTileError = () => {
  if (!tileWarning) {
    tileWarning = true;
    toast("Street map is unavailable. Your local canvas still works.");
  }
};

function releaseStroke() {
  space = false;
  previousPixel = null;
}
for (const event of ["blur", "pointercancel", "pagehide", "contextmenu"])
  window.addEventListener(event, releaseStroke);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseStroke();
    persist();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    $("#modal").open ||
    event.target.closest("input,textarea,select,[contenteditable=true]")
  )
    return;
  if (event.code === "Space" && painting) {
    event.preventDefault();
    if (!space) {
      space = true;
      queuePixel(pointer);
    }
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    painting
  ) {
    event.preventDefault();
    if (!submitting) state.undo();
    update();
  } else if (event.key.toLowerCase() === "p") openPaint();
  else if (event.key.toLowerCase() === "e" && painting) selectColor(0);
  else if (event.key === "Escape") {
    closePaint();
    $("#layers-popover").hidden = true;
    $("#pixel-info").hidden = true;
  } else if (event.key === "+" || event.key === "=") map.zoom(1);
  else if (event.key === "-") map.zoom(-1);
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") releaseStroke();
});

function showCoordinates(pixel = map.atPoint(innerWidth / 2, innerHeight / 2)) {
  const p = describePixel(...pixel);
  $("#coordinates").textContent =
    `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · z${map.location.zoom.toFixed(1)}`;
}
function showPixel(pixel) {
  const p = describePixel(...pixel),
    panel = $("#pixel-info");
  panel.innerHTML = `<div class="card-heading">Pixel details <button class="icon-button" aria-label="Close pixel details">×</button></div><p>Tile <strong>${p.tile.join(", ")}</strong> · Pixel <strong>${p.pixel.join(", ")}</strong></p><p class="muted small">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p><button class="btn btn-primary">Paint here</button>`;
  panel.hidden = false;
  panel.querySelector(".icon-button").onclick = () => {
    panel.hidden = true;
  };
  panel.querySelector(".btn-primary").onclick = () => {
    map.jump({ ...toLocation(pixel[0] + 0.5, pixel[1] + 0.5), zoom: 15 });
    openPaint();
  };
}

const modal = $("#modal");
function openModal(title, content, type = "") {
  releaseStroke();
  modal.className = `modal ${type}`;
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = content;
  if (!modal.open) modal.showModal();
  icons($("#modal-content"));
}
function closeModal() {
  modal.close();
}
$("#close-modal").onclick = closeModal;
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

function showLogin(paintAfter = false) {
  openModal(
    "Local demo",
    '<div class="wordmark"><img src="/assets/globe.svg" alt="">wplace</div><p>Paint a little piece of the world.</p><p class="muted">Try the complete painting flow in your own local canvas.</p><button id="enter-demo" class="btn btn-primary">Enter local demo <span>→</span></button><div class="local-note">No account needed. Pixels are saved in this browser.<br>This preview is independent of Wplace.live.</div>',
    "login",
  );
  $("#enter-demo").onclick = () => {
    demo = true;
    persist();
    closeModal();
    update();
    if (paintAfter) openPaint();
    else toast("Welcome! Choose Paint to start your first pixel.");
  };
}

function showInfo() {
  openModal(
    "About this canvas",
    '<div class="wordmark"><img src="/assets/globe.svg" alt="">wplace</div><p class="muted small" style="text-align:center;margin-top:8px">A local frontend reconstruction</p><h2>A world made one pixel at a time</h2><p>Explore the map, choose a color, and add your own pixels. The interface follows the public Wplace layout and the painter project’s input contract.</p><h2>How to paint faster</h2><p>Hold <kbd>SPACE</kbd> and move your cursor over the map. Drag without Space to move the map. Select Paint to save your batch.</p><h2>Your own local canvas</h2><p>Paint charges refill every 30 seconds. All colors are available in the demo. Your pixels survive a refresh, and you can export them from your account.</p><p class="local-note">Artwork, when available, is a cached public reference. Rankings are sample data. Login, painting, and charges are local simulations; nothing is posted to Wplace.</p><p class="muted small">Map: MapLibre · Optional street tiles © OpenStreetMap contributors<br>Icons: Lucide · Reference: Wplace public UI v1.6.12, 2026-09-08</p><a href="https://wplace.live/" target="_blank" rel="noreferrer">Visit the original Wplace ↗</a>',
  );
}
function showShortcuts() {
  openModal(
    "Keyboard shortcuts",
    '<div class="shortcut-list"><div><span>Open paint palette</span><kbd>P</kbd></div><div><span>Continuous pixel stroke</span><span><kbd>SPACE</kbd> + move</span></div><div><span>Move the map</span><span>Click + drag</span></div><div><span>Undo selected pixel</span><span><kbd>Ctrl</kbd> + <kbd>Z</kbd></span></div><div><span>Eraser</span><kbd>E</kbd></div><div><span>Zoom in / out</span><span><kbd>+</kbd> / <kbd>−</kbd></span></div><div><span>Close palette or dialog</span><kbd>ESC</kbd></div></div>',
  );
}

const places = [
  {
    name: "Paris",
    country: "France",
    flag: "🇫🇷",
    lat: PARIS.lat,
    lng: PARIS.lng,
  },
  { name: "Tokyo", country: "Japan", flag: "🇯🇵", lat: 35.6762, lng: 139.6503 },
  {
    name: "Shanghai",
    country: "China",
    flag: "🇨🇳",
    lat: 31.2304,
    lng: 121.4737,
  },
  {
    name: "New York",
    country: "United States",
    flag: "🇺🇸",
    lat: 40.7128,
    lng: -74.006,
  },
  {
    name: "London",
    country: "United Kingdom",
    flag: "🇬🇧",
    lat: 51.5074,
    lng: -0.1278,
  },
  {
    name: "São Paulo",
    country: "Brazil",
    flag: "🇧🇷",
    lat: -23.5505,
    lng: -46.6333,
  },
];
function visit(place) {
  map.jump({ ...place, zoom: place.name === "Paris" ? PARIS.zoom : 12 });
  searchRecent = [
    place.name,
    ...searchRecent.filter((n) => n !== place.name),
  ].slice(0, 5);
  if (place.name !== "Paris") {
    $("#streets-toggle").checked = true;
    setStreets(true);
  }
  persist();
  closeModal();
  toast(`${place.name} · your local canvas`);
}
function showSearch() {
  openModal(
    "Search",
    '<input id="place-query" class="search-field" type="search" placeholder="Search a place or enter latitude, longitude" aria-label="Search locations" autocomplete="off"><p id="search-caption" class="muted small" style="margin-top:18px">Explore places · or enter coordinates</p><div id="search-results" class="search-results"></div>',
  );
  const input = $("#place-query");
  function results() {
    const queryText = input.value.trim().toLowerCase();
    const coords = queryText.match(
      /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
    );
    let matches = places.filter((p) =>
      `${p.name} ${p.country}`.toLowerCase().includes(queryText),
    );
    if (
      coords &&
      Math.abs(Number(coords[1])) <= 85 &&
      Math.abs(Number(coords[2])) <= 180
    )
      matches = [
        {
          name: "Coordinates",
          country: `${coords[1]}, ${coords[2]}`,
          flag: "⌖",
          lat: Number(coords[1]),
          lng: Number(coords[2]),
        },
      ];
    $("#search-results").replaceChildren();
    if (!matches.length) {
      $("#search-caption").textContent =
        "No matching demo place. Try latitude, longitude.";
      return;
    }
    $("#search-caption").textContent = queryText
      ? "Locations"
      : searchRecent.length
        ? "Recent & suggested places"
        : "Suggested places";
    if (!queryText)
      matches.sort(
        (a, b) =>
          Number(searchRecent.includes(b.name)) -
          Number(searchRecent.includes(a.name)),
      );
    for (const place of matches) {
      const button = document.createElement("button");
      button.className = "location-result";
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.textContent = place.flag;
      const text = document.createElement("span"),
        strong = document.createElement("strong"),
        small = document.createElement("small");
      strong.textContent = place.name;
      small.textContent = place.country;
      text.append(strong, small);
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "↗";
      button.append(flag, text, arrow);
      button.onclick = () => visit(place);
      $("#search-results").append(button);
    }
  }
  input.oninput = results;
  input.onkeydown = (event) => {
    if (event.key === "Enter") $("#search-results button")?.click();
  };
  results();
  input.focus();
}

function showLeaderboard() {
  openModal(
    "Leaderboard",
    '<div class="tabs" role="tablist" aria-label="Leaderboard category"></div><p class="muted small">Sample rankings for this local preview</p><table class="ranking"><thead><tr><th>#</th><th id="rank-name">Region</th><th style="text-align:right">Pixels painted</th><th></th></tr></thead><tbody></tbody></table>',
    "leaderboard",
  );
  for (const category of ["Regions", "Countries", "Players", "Alliances"]) {
    const button = document.createElement("button");
    button.textContent = category;
    button.setAttribute("role", "tab");
    button.onclick = () => {
      for (const tab of $(".tabs").children) {
        tab.classList.toggle("active", tab === button);
        tab.setAttribute("aria-selected", String(tab === button));
      }
      $("#rank-name").textContent = category.slice(0, -1);
      const rows =
        category === "Players"
          ? [
              "Pixel wanderer",
              "You · local demo",
              "Cloud painter",
              "Blue marble",
              "Little brush",
              "Map explorer",
            ]
          : category === "Alliances"
            ? [
                "Paris pixel club",
                "Tokyo colors",
                "Shanghai artists",
                "New York canvas",
                "London palette",
                "Brazil paints",
              ]
            : places.map((p) =>
                category === "Countries" ? p.country : p.name,
              );
      const tbody = $(".ranking tbody");
      tbody.replaceChildren();
      rows.forEach((name, i) => {
        const row = document.createElement("tr");
        for (const text of [
          i + 1,
          `${places[i].flag} ${name}`,
          (category === "Players" && i === 1
            ? state.totalPainted
            : [172304, 84750, 72819, 68140, 61590, 58432][i]
          ).toLocaleString(),
        ]) {
          const td = document.createElement("td");
          td.textContent = text;
          row.append(td);
        }
        const cell = document.createElement("td"),
          visitButton = document.createElement("button");
        visitButton.className = "btn";
        visitButton.textContent = "Visit";
        visitButton.onclick = () => visit(places[i]);
        cell.append(visitButton);
        row.append(cell);
        tbody.append(row);
      });
    };
    $(".tabs").append(button);
  }
  $(".tabs button").click();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportPng() {
  if (!state.pixels.size) {
    toast("Paint some pixels before exporting.");
    return;
  }
  const pixels = [...state.pixels].map(([key, color]) => [
    ...key.split(",").map(Number),
    color,
  ]);
  const xs = pixels.map((p) => p[0]),
    ys = pixels.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    width = Math.max(...xs) - minX + 1,
    height = Math.max(...ys) - minY + 1;
  if (width * height > 16000000 || width > 8192 || height > 8192) {
    toast("Pixels span too large an area for PNG. Use JSON export.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  for (const [x, y, color] of pixels) {
    if (color) {
      ctx.fillStyle = palette[color].hex;
      ctx.fillRect(x - minX, y - minY, 1, 1);
    }
  }
  canvas.toBlob((blob) => {
    if (blob) download(blob, "wplace-local-pixels.png");
  });
}
function showAccount() {
  if (!demo) {
    showLogin();
    return;
  }
  openModal(
    "Your local canvas",
    `<div class="wordmark"><img src="/assets/globe.svg" alt="">wplace</div><div class="account-stats"><div class="stat"><span class="muted small">PAINT CHARGES</span><strong>${Math.floor(state.charges)} <span class="muted small">/ 50</span></strong></div><div class="stat"><span class="muted small">PIXELS PAINTED</span><strong>${state.totalPainted}</strong></div></div><p class="muted small">One charge recovers every 30 seconds. For testing, you can refill instantly.</p><div class="account-actions"><button id="refill" class="btn btn-primary">Refill demo charges</button><button id="export-png" class="btn">Export my pixels as PNG</button><button id="export-json" class="btn">Export pixel data as JSON</button><button id="leave-demo" class="text-button">Leave demo account</button></div><p class="local-note" style="margin-top:20px">This is a local demo account. No real login, purchases or shared-world changes are made.</p>`,
  );
  $("#refill").onclick = () => {
    state.charges = MAX_CHARGES;
    state.updatedAt = Date.now();
    persist();
    update();
    showAccount();
    toast("Demo charges refilled.");
  };
  $("#export-png").onclick = exportPng;
  $("#export-json").onclick = () =>
    download(
      new Blob(
        [
          JSON.stringify(
            { ...state.serialize(), location: map.location },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "wplace-local-pixels.json",
    );
  $("#leave-demo").onclick = () => {
    demo = false;
    closePaint();
    persist();
    update();
    closeModal();
  };
}

function setOpacity(value) {
  map.opacity = Number(value) / 100;
  $("#opacity").value = value;
  $("#opacity-value").textContent = `${value}%`;
  for (const button of $("#opacity-presets").children)
    button.classList.toggle(
      "active",
      Number(button.dataset.opacity) === Number(value),
    );
  map.render();
}
function setStreets(enabled) {
  map.setStreetMap(enabled);
  $("#attribution").innerHTML = enabled
    ? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · MapLibre · local edits'
    : map.reference
      ? "Wplace community artwork · cached reference · local edits"
      : "Local demo canvas · MapLibre";
}

$("#paint").onclick = openPaint;
$("#close-paint").onclick = closePaint;
$("#submit").onclick = () => submit().catch((error) => toast(error.message));
$("#undo").onclick = () => {
  state.undo();
  update();
};
$("#clear").onclick = () => {
  state.clear();
  update();
};
$("#all-colors").onclick = () => {
  allColors = !allColors;
  try {
    localStorage.setItem("show-all-colors", String(allColors));
  } catch {}
  renderPalette();
};
$("#info").onclick = showInfo;
$("#preview-badge").onclick = showInfo;
$("#account").onclick = showAccount;
$("#search").onclick = showSearch;
$("#leaderboard").onclick = showLeaderboard;
$("#shortcuts").onclick = showShortcuts;
$("#zoom-in").onclick = () => map.zoom(1);
$("#zoom-out").onclick = () => map.zoom(-1);
$("#my-location").onclick = () => {
  map.jump(PARIS);
  toast("Back to Paris · reference canvas");
};
$("#layers").onclick = () => {
  $("#layers-popover").hidden = !$("#layers-popover").hidden;
};
$("#close-layers").onclick = () => {
  $("#layers-popover").hidden = true;
};
$("#opacity").oninput = (event) => setOpacity(event.target.value);
for (const button of $("#opacity-presets").children)
  button.onclick = () => setOpacity(button.dataset.opacity);
$("#grid-toggle").onchange = (event) => {
  map.grid = event.target.checked;
  map.render();
};
$("#streets-toggle").onchange = (event) => setStreets(event.target.checked);
const chargeClock = setInterval(update, 1000);
window.addEventListener(
  "pagehide",
  () => {
    persist();
    clearInterval(chargeClock);
    clearTimeout(toastTimer);
    clearTimeout(persistenceTimer);
    map.dispose();
  },
  { once: true },
);

// An explicit local inspection surface supports the opt-in Python smoke runner.
window.wplacePreview = {
  ready: true,
  submit,
  snapshot: () => ({
    mode: "local-only",
    pending: [...state.pending].map(([key, color]) => [
      ...key.split(",").map(Number),
      color,
    ]),
    ...state.serialize(),
    location: map.location,
    scale: map.scale,
    painting,
    selected,
    reference: !!map.reference,
  }),
};
renderPalette();
update();
showCoordinates();
