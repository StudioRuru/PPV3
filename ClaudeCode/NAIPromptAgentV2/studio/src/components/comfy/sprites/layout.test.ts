import assert from "node:assert/strict";
import { test } from "node:test";
import { circleLayout } from "./layout";

test("keys sit on a circle inside the box, deterministic", () => {
  const keys = ["a", "b", "c", "d", "e"];
  const l = circleLayout(keys, 400, 300);
  assert.deepEqual(l, circleLayout(keys, 400, 300));
  for (const k of keys) { const p = l[k]; assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300); }
  const r = keys.map((k) => Math.hypot(l[k].x - 200, l[k].y - 150));
  assert.ok(Math.max(...r) - Math.min(...r) < 1e-6);
});
test("stand is top-centre and the rest keep their order around it", () => {
  const l = circleLayout(["a", "b", "stand", "c"], 400, 300);
  assert.ok(Math.abs(l.stand.x - 200) < 1e-6);
  assert.ok(Object.values(l).every((p) => p.y >= l.stand.y - 1e-6));
});
test("single and empty inputs", () => {
  assert.deepEqual(circleLayout([], 10, 10), {});
  assert.equal(Object.keys(circleLayout(["x"], 100, 100)).length, 1);
});
