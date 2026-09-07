import { createServer } from "node:http";
import { readFile, stat, realpath, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const cache = resolve(root, "../.local/frontend");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const referenceFiles = {
  "paris.png": "https://backend.wplace.live/files/s0/tiles/1037/704.png",
  "geist.woff2":
    "https://wplace.live/_app/immutable/assets/Geist-latin.Dg_dQHbK.woff2",
  "pixelify.woff2":
    "https://wplace.live/_app/immutable/assets/PixelifySans-latin.vdc2vUDH.woff2",
};
const vendorFiles = {
  "maplibre-gl.js": "maplibre-gl/dist/maplibre-gl.js",
  "maplibre-gl.css": "maplibre-gl/dist/maplibre-gl.css",
  "lucide.js": "lucide/dist/umd/lucide.js",
};

export async function cacheReference() {
  await mkdir(cache, { recursive: true });
  for (const [name, url] of Object.entries(referenceFiles)) {
    try {
      if (await stat(resolve(cache, name)).catch(() => null)) continue;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024)
        throw new Error("Reference is too large");
      await writeFile(resolve(cache, name), bytes);
      console.info(`Cached public reference: ${name}`);
    } catch (error) {
      console.warn(
        `Reference ${name} unavailable; using local fallback (${error.message})`,
      );
    }
  }
}

export function createPreviewServer() {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://tile.openstreetmap.org; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const host = request.headers.host?.split(":")[0];
      if (host !== "127.0.0.1" && host !== "localhost") {
        response.writeHead(403);
        response.end();
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/api/health") {
        const available = await Promise.all(
          Object.keys(referenceFiles).map(async (name) => [
            name,
            !!(await stat(resolve(cache, name)).catch(() => null)),
          ]),
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          request.method === "HEAD"
            ? undefined
            : JSON.stringify({
                app: "wplace-local-preview",
                mode: "local-only",
                references: Object.fromEntries(available),
              }),
        );
        return;
      }
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/vendor/")) {
        const vendor = vendorFiles[path.slice(8)];
        if (!vendor) {
          response.writeHead(404);
          response.end();
          return;
        }
        const body = await readFile(resolve(root, "node_modules", vendor));
        response.writeHead(200, {
          "Content-Type": mime[extname(vendor)],
          "Content-Length": body.length,
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      const referenceName = path.startsWith("/reference/")
        ? path.slice(11)
        : null;
      const base = referenceName ? cache : root;
      if (referenceName && !Object.hasOwn(referenceFiles, referenceName)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const file = resolve(
        base,
        referenceName || (path === "/" ? "index.html" : `.${path}`),
      );
      if (
        !file.startsWith(base + sep) ||
        path.includes("\\") ||
        path.includes("\0")
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      // Resolve links before reading; never serve repository data or arbitrary files.
      const resolved = await realpath(file);
      if (
        !resolved.startsWith(base + sep) ||
        !mime[extname(resolved)] ||
        resolved.endsWith("server.mjs") ||
        resolved.includes(`${sep}tests${sep}`) ||
        resolved.includes(`${sep}node_modules${sep}`)
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      const body = await readFile(resolved);
      response.writeHead(200, {
        "Content-Type": mime[extname(resolved)],
        "Content-Length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 400);
      response.end("Not available");
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const port = portIndex < 0 ? 5173 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid --port");
  if (args.includes("--reference")) await cacheReference();
  const server = createPreviewServer();
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.info(`WPlace local preview: http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
