// Local module exports used by the repository's unchanged paint_btn.js smoke test.
// They deliberately perform no network requests and never emulate authentication.
export const season = 0;
export const patches = [{ version: "local-preview-1" }];
let pendingBatch = null;

export const painter = {
  async paint(pixels) {
    if (!window.wplacePreview || !Array.isArray(pixels))
      throw new Error("Local preview is not ready");
    const expected = window.wplacePreview.snapshot().pending;
    const actual = pixels.map((p) => [
      p.tile[0] * 1000 + p.pixel[0],
      p.tile[1] * 1000 + p.pixel[1],
      p.colorIdx,
    ]);
    const sorted = (entries) => entries.map((p) => p.join(",")).sort();
    if (JSON.stringify(sorted(expected)) !== JSON.stringify(sorted(actual))) {
      throw new Error(
        "Injected payload differs from the visible selected pixels",
      );
    }
    if (pixels.some((p) => p.season !== season))
      throw new Error("Invalid local season");
    pendingBatch = actual;
  },
};

export async function worker(pixels) {
  if (!pendingBatch || pixels.length !== pendingBatch.length)
    throw new Error("No validated local batch");
  const result = await window.wplacePreview.submit();
  window.wplacePreview.lastBridgeBatch = result;
  pendingBatch = null;
}
