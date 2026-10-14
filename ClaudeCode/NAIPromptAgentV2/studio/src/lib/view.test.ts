import { test } from "node:test";
import assert from "node:assert/strict";
import { clampView, zoomAt } from "./view";

test("zoomAt keeps the point under the fingers fixed and follows them while pinching", () => {
  const v = zoomAt({ s: 1, x: 0, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 50 }, 2);
  assert.deepEqual(v, { s: 2, x: -100, y: -50 });               // the image point at (100,50) stays under the fingers
  assert.deepEqual(zoomAt(v, { x: 100, y: 50 }, { x: 120, y: 50 }, 1), { s: 2, x: -80, y: -50 }); // two-finger pan
  assert.equal(zoomAt({ s: 4, x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 3).s, 5);       // capped at 5×
});

test("clampView stops panning at the image edges; at 1× the image stays centred", () => {
  const img = { w: 400, h: 600 }, box = { w: 400, h: 700 };
  assert.deepEqual(clampView({ s: 2, x: 999, y: -999 }, img, box), { s: 2, x: 200, y: -250 });
  assert.deepEqual(clampView({ s: 1, x: 50, y: 50 }, img, box), { s: 1, x: 0, y: 0 });
});
