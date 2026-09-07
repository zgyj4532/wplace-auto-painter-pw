import {
  PARIS,
  PIXEL_SCALE,
  REFERENCE_ZOOM,
  WORLD_SIZE,
  toWorld,
  toLocation,
} from "./model.mjs";

// MapLibre owns the camera, Mercator projection, gesture handling and tile loading.
// The offset preserves the existing Python painter's 7.65px input calibration.
const ZOOM_OFFSET = Math.log2(
  PIXEL_SCALE / ((512 * 2 ** REFERENCE_ZOOM) / WORLD_SIZE),
);

export class PixelMap {
  constructor(canvas, paintState, palette, location = PARIS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = paintState;
    this.palette = palette;
    this.opacity = 1;
    this.grid = true;
    this.hover = null;
    this.reference = null;
    this.frame = null;
    this.map = new maplibregl.Map({
      container: "basemap",
      center: [location.lng, location.lat],
      zoom: location.zoom + ZOOM_OFFSET,
      minZoom: 2 + ZOOM_OFFSET,
      maxZoom: 18 + ZOOM_OFFSET,
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "paper",
            type: "background",
            paint: { "background-color": "#edf0e6" },
          },
        ],
      },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disable();
    this.map.on("move", () => {
      this.render();
      this.onMove?.();
    });
    this.map.on("resize", () => this.resize());
    this.map.on("load", () => this.render());
    this.map.on("error", () => this.onTileError?.());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  get scale() {
    return PIXEL_SCALE * 2 ** (this.location.zoom - REFERENCE_ZOOM);
  }
  get location() {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: this.map.getZoom() - ZOOM_OFFSET };
  }
  get center() {
    const c = this.location;
    return toWorld(c.lat, c.lng);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  atPoint(x, y) {
    const center = this.center,
      scale = this.scale;
    return [
      Math.floor(center.x + (x - this.width / 2) / scale),
      Math.floor(center.y + (y - this.height / 2) / scale),
    ];
  }

  screen(x, y) {
    const center = this.center,
      scale = this.scale;
    return [
      this.width / 2 + (x - center.x) * scale,
      this.height / 2 + (y - center.y) * scale,
    ];
  }

  jump(location) {
    this.map.jumpTo({
      center: [location.lng, location.lat],
      zoom: (location.zoom ?? this.location.zoom) + ZOOM_OFFSET,
    });
  }
  zoom(delta) {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 160 });
  }

  async loadReference() {
    this.reference = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = "/reference/paris.png";
    });
    this.render();
  }

  setStreetMap(enabled) {
    if (!this.map.isStyleLoaded()) {
      this.map.once("load", () => this.setStreetMap(enabled));
      return;
    }
    if (enabled && !this.map.getSource("streets")) {
      this.map.addSource("streets", {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
      });
      this.map.addLayer({ id: "streets", type: "raster", source: "streets" });
    }
    if (this.map.getLayer("streets"))
      this.map.setLayoutProperty(
        "streets",
        "visibility",
        enabled ? "visible" : "none",
      );
  }

  render() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  draw() {
    const ctx = this.ctx,
      scale = this.scale;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = this.opacity;
    const [rx, ry] = this.screen(1037000, 704000);
    if (this.reference)
      ctx.drawImage(this.reference, rx, ry, 1000 * scale, 1000 * scale);
    else {
      // A neutral offline tile remains drawable when reference material is unavailable.
      ctx.fillStyle = "#fafbf7";
      ctx.fillRect(rx, ry, 1000 * scale, 1000 * scale);
    }
    for (const [key, color] of this.state.pixels)
      this.drawPixel(key, color, false);
    ctx.globalAlpha = 1;
    for (const [key, color] of this.state.pending)
      this.drawPixel(key, color, true);
    if (this.grid && scale >= 6) {
      const center = this.center;
      const startX =
        (((this.width / 2 - center.x * scale) % scale) + scale) % scale;
      const startY =
        (((this.height / 2 - center.y * scale) % scale) + scale) % scale;
      ctx.strokeStyle = "#16354c16";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = startX; x < this.width; x += scale) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
      }
      for (let y = startY; y < this.height; y += scale) {
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y);
      }
      ctx.stroke();
    }
    if (this.hover && this.painting) {
      const [x, y] = this.screen(...this.hover);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, scale, scale);
      ctx.strokeStyle = "#233e62";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, scale, scale);
    }
  }

  drawPixel(key, color, pending) {
    const ctx = this.ctx,
      scale = this.scale;
    const [x, y] = this.screen(...key.split(",").map(Number));
    if (x < -scale || y < -scale || x > this.width || y > this.height) return;
    if (color === 0) ctx.clearRect(x, y, scale + 0.05, scale + 0.05);
    else {
      ctx.fillStyle = this.palette[color].hex;
      ctx.fillRect(x, y, scale + 0.05, scale + 0.05);
    }
    if (pending && scale >= 4) {
      ctx.strokeStyle = "#fff9";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, scale - 1, scale - 1);
    }
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.map.remove();
  }
}

export function describePixel(x, y) {
  const location = toLocation(x, y);
  return {
    tile: [Math.floor(x / 1000), Math.floor(y / 1000)],
    pixel: [x % 1000, y % 1000],
    ...location,
  };
}
