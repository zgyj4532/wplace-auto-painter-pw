import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { request } from "node:http";

test("preview serves executable modules with correct MIME and protects repository data", async (t) => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.app, "wplace-local-preview");
  assert.equal(health.mode, "local-only");
  for (const path of [
    "/app.mjs",
    "/vendor/maplibre-gl.js",
    "/vendor/lucide.js",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /javascript/);
    await response.arrayBuffer();
  }
  for (const path of [
    "/server.mjs",
    "/%2e%2e%2fdata/config.json",
    "/..%5cdata%5cconfig.json",
    "/reference/../../data/config.json",
    "/node_modules/lucide/package.json",
  ]) {
    const response = await fetch(base + path);
    assert.ok(response.status >= 400, path);
    assert.equal((await response.text()).includes("credentials"), false);
  }
  assert.equal(
    (await fetch(base, { method: "POST", body: "paint" })).status,
    405,
  );
  const rejectedHost = await new Promise((resolve) => {
    request(base, { headers: { Host: "untrusted.example" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).end();
  });
  assert.equal(rejectedHost, 403);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.match(
    head.headers.get("content-security-policy"),
    /form-action 'self'/,
  );
});
