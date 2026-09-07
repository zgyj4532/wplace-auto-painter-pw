import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PaintState,
  CHARGE_MS,
  toWorld,
  toLocation,
  lineBetween,
  WORLD_SIZE,
} from "../model.mjs";

test("a submitted batch consumes each selected coordinate once and survives serialization", () => {
  const state = new PaintState({}, 0);
  state.queue(10, 20, 7);
  state.queue(10, 20, 19);
  state.queue(11, 20, 7);
  assert.deepEqual(state.submit(0), [
    [10, 20, 19],
    [11, 20, 7],
  ]);
  assert.equal(state.charges, 48);
  assert.equal(state.pending.size, 0);
  const restored = new PaintState(state.serialize(), 0);
  assert.deepEqual(
    [...restored.pixels],
    [
      ["10,20", 19],
      ["11,20", 7],
    ],
  );
  assert.equal(restored.totalPainted, 2);
  assert.throws(() => restored.submit(0), /Add a pixel/);
});

test("charge limits retain a valid batch and recover after the 30-second interval", () => {
  const state = new PaintState({ charges: 1, updatedAt: 0 }, 0);
  assert.equal(state.queue(1, 1, 1), true);
  assert.equal(state.queue(2, 1, 1), false);
  state.submit(0);
  assert.equal(state.charges, 0);
  state.recharge(CHARGE_MS - 1);
  assert.equal(state.queue(2, 1, 1), false);
  state.recharge(CHARGE_MS);
  assert.equal(state.queue(2, 1, 1), true);
  state.recharge(CHARGE_MS * 100);
  assert.equal(state.charges, 50);
});

test("undo restores overwritten selections including transparent pixels", () => {
  const state = new PaintState({}, 0);
  state.queue(1, 1, 7);
  state.queue(1, 1, 0);
  state.undo();
  assert.equal(state.pending.get("1,1"), 7);
  state.undo();
  assert.equal(state.pending.size, 0);
  state.queue(2, 2, 0);
  state.submit(0);
  assert.equal(state.pixels.get("2,2"), 0);
});

test("invalid coordinates and corrupt persistence cannot create paint outside the world", () => {
  const state = new PaintState(
    {
      charges: -100,
      updatedAt: Infinity,
      pixels: [[1, 2, 3], [-1, 2, 3], [0, WORLD_SIZE, 3], [1, 2, 999], null],
    },
    0,
  );
  assert.equal(state.charges, 0);
  assert.equal(state.pixels.size, 1);
  assert.equal(state.queue(-1, 2, 3), false);
  assert.equal(state.queue(1, 2.5, 3), false);
});

test("coordinates match the project's Paris tile and round trip in both hemispheres", () => {
  const paris = toWorld(48.8537151734952, 2.3484026030630787);
  assert.equal(Math.floor(paris.x / 1000), 1037);
  assert.equal(Math.floor(paris.y / 1000), 704);
  for (const [lat, lng] of [
    [0, 0],
    [48.853715, 2.348403],
    [-33.86, 151.2],
    [35.6762, 139.6503],
  ]) {
    const world = toWorld(lat, lng),
      result = toLocation(world.x, world.y);
    assert.ok(Math.abs(result.lat - lat) < 1e-8);
    assert.ok(Math.abs(result.lng - lng) < 1e-8);
  }
});

test("a diagonal stroke contains only adjacent pixels and includes endpoints", () => {
  const points = lineBetween([4, 7], [-3, -2]);
  assert.deepEqual(points[0], [4, 7]);
  assert.deepEqual(points.at(-1), [-3, -2]);
  for (let i = 1; i < points.length; i++)
    assert.equal(
      Math.max(
        Math.abs(points[i][0] - points[i - 1][0]),
        Math.abs(points[i][1] - points[i - 1][1]),
      ),
      1,
    );
});

test("palette uses the existing free and extended color IDs", async () => {
  const colors = JSON.parse(
    await readFile(new URL("../palette.json", import.meta.url)),
  );
  assert.equal(colors.length, 64);
  assert.deepEqual(colors[7], { id: 7, name: "Red", hex: "#ed1c24" });
  assert.deepEqual(colors[63], { id: 63, name: "Light Stone", hex: "#cdc59e" });
});
