// Pixel coordinates and palette IDs follow app/schemas/coords.py and bot7685_ext.
export const WORLD_SIZE = 2048000;
export const PIXEL_SCALE = 7.65;
export const REFERENCE_ZOOM = 15;
export const PARIS = {
  lat: 48.8537151734952,
  lng: 2.3484026030630787,
  zoom: 14.5,
};
export const CHARGE_MS = 30000;
export const MAX_CHARGES = 50;
export const STORAGE_KEY = "wplace-local-preview-v1";

export function toWorld(lat, lng) {
  lat = Math.max(-85.051128, Math.min(85.051128, lat));
  return {
    x: ((lng * Math.PI) / 180) * 325949.3234522017 + 1023999.5,
    y:
      Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) *
        -325949.3234522014 +
      1023999.4999999999,
  };
}

export function toLocation(x, y) {
  return {
    lat:
      ((2 * Math.atan(Math.exp((y - 1023999.4999999999) / -325949.3234522014)) -
        Math.PI / 2) *
        180) /
      Math.PI,
    lng: (((x - 1023999.5) / 325949.3234522017) * 180) / Math.PI,
  };
}

export function lineBetween(start, end) {
  let [x, y] = start;
  const [tx, ty] = end;
  const dx = Math.abs(tx - x),
    dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1,
    sy = y < ty ? 1 : -1;
  let error = dx - dy;
  const points = [];
  while (true) {
    points.push([x, y]);
    if (x === tx && y === ty) return points;
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }
  }
}

export function pixelKey(x, y) {
  return `${x},${y}`;
}
export function validPixel(x, y, color) {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < WORLD_SIZE &&
    y < WORLD_SIZE &&
    Number.isInteger(color) &&
    color >= 0 &&
    color <= 63
  );
}

export class PaintState {
  constructor(saved = {}, now = Date.now()) {
    this.pixels = new Map();
    for (const entry of Array.isArray(saved.pixels)
      ? saved.pixels.slice(0, 50000)
      : []) {
      if (Array.isArray(entry) && entry.length === 3 && validPixel(...entry)) {
        this.pixels.set(pixelKey(entry[0], entry[1]), entry[2]);
      }
    }
    this.charges = Number.isFinite(saved.charges)
      ? Math.max(0, Math.min(MAX_CHARGES, saved.charges))
      : MAX_CHARGES;
    this.updatedAt = Number.isFinite(saved.updatedAt)
      ? Math.min(now, saved.updatedAt)
      : now;
    this.totalPainted =
      Number.isSafeInteger(saved.totalPainted) && saved.totalPainted >= 0
        ? saved.totalPainted
        : 0;
    this.pending = new Map();
    this.history = [];
    this.recharge(now);
  }

  recharge(now = Date.now()) {
    this.charges = Math.min(
      MAX_CHARGES,
      this.charges + Math.max(0, now - this.updatedAt) / CHARGE_MS,
    );
    this.updatedAt = now;
  }

  queue(x, y, color) {
    if (!validPixel(x, y, color)) return false;
    const key = pixelKey(x, y);
    if (this.pending.get(key) === color) return false;
    if (!this.pending.has(key) && this.pending.size >= Math.floor(this.charges))
      return false;
    this.history.push({ key, previous: this.pending.get(key) });
    this.pending.set(key, color);
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    if (previous.previous === undefined) this.pending.delete(previous.key);
    else this.pending.set(previous.key, previous.previous);
  }

  clear() {
    this.pending.clear();
    this.history = [];
  }

  submit(now = Date.now()) {
    this.recharge(now);
    if (!this.pending.size) throw new Error("Add a pixel to the map first.");
    if (this.pending.size > Math.floor(this.charges))
      throw new Error("Wait for more paint charges.");
    const batch = [...this.pending].map(([key, color]) => [
      ...key.split(",").map(Number),
      color,
    ]);
    for (const [key, color] of this.pending) this.pixels.set(key, color);
    this.charges -= this.pending.size;
    this.totalPainted += this.pending.size;
    this.clear();
    return batch;
  }

  serialize() {
    return {
      version: 1,
      charges: this.charges,
      updatedAt: this.updatedAt,
      totalPainted: this.totalPainted,
      pixels: [...this.pixels].map(([key, color]) => [
        ...key.split(",").map(Number),
        color,
      ]),
    };
  }
}
