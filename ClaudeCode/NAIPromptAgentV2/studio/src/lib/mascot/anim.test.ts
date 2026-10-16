import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, hopPath, idleWave, kick, stepSpring, vertexOffset, WARP, type WarpState } from "./anim";

const calm = (o: Partial<WarpState> = {}): WarpState => ({ t: 0, sway: 0, breathe: 0, squash: { x: 0, v: 0 }, drag: { vx: 0, vy: 0 }, ...o });

test("spring settles after a kick", () => {
  let s = kick({ x: 0, v: 0 }, 5), peak = 0;
  for (let i = 0; i < 180; i++) { s = stepSpring(s, 1 / 60); peak = Math.max(peak, Math.abs(s.x)); }
  assert.ok(peak > 0.05);
  assert.ok(Math.abs(s.x) < 1e-3 && Math.abs(s.v) < 1e-2);
  assert.deepEqual(stepSpring({ x: 1, v: 0 }, 100).x < 2, true); // stalled frame is clamped
});

test("vertex offsets are zero outside the bands and bounded inside", () => {
  const s = calm({ sway: 1, breathe: 1, drag: { vx: 50, vy: 0 } });
  assert.deepEqual(vertexOffset(0.5, 0.8, s, "stand"), [0, 0]); // below the chest band
  assert.ok(vertexOffset(0.5, 0.3, calm({ breathe: 1 }), "stand").every((n) => Math.abs(n) < 1e-9)); // band edge weight 0
  for (let v = 0; v <= 0.6; v += 0.01) {
    const [dx, dy] = vertexOffset(0.5, v, s, "stand");
    assert.ok(Math.abs(dx) <= WARP.swayAmp + WARP.dragGain * WARP.dragMax + 1e-9 && Math.abs(dy) <= WARP.breatheAmp + 1e-9);
  }
  assert.ok(vertexOffset(0.5, 0.0, calm({ sway: 1 }), "stand")[0] > 0);
  assert.ok(vertexOffset(0.5, 0.0, calm({ drag: { vx: 1, vy: 0 } }), "stand")[0] < 0); // lags opposite to drag
  assert.ok(vertexOffset(0.5, 0.425, calm({ breathe: 1 }), "stand")[1] < 0);
});

test("squash scales about the feet", () => {
  const s = calm({ squash: { x: 0.1, v: 0 } });
  assert.equal(vertexOffset(0.5, 1, s, "stand")[1], 0);
  assert.ok(vertexOffset(0.5, 0.5, s, "stand")[1] < 0);
});

test("lie and sit use x-bands at reduced amplitude", () => {
  assert.equal(bandFor("lie", 0.1).band, "none"); // upright head band would be here
  assert.equal(bandFor("lie", 0.9).band, "head");
  assert.equal(bandFor("sit", 0.55).band, "chest");
  assert.equal(bandFor("stand", 0.1).band, "head");
  const s = calm({ sway: 1 });
  assert.deepEqual(vertexOffset(0.9, 0.9, calm(), "lie"), [0, 0]);
  const lie = vertexOffset(1, 0.5, s, "lie")[0], stand = vertexOffset(0.5, 0, s, "stand")[0];
  assert.ok(lie > 0 && lie < stand);
});

test("idleWave stays in -1..1", () => {
  for (let t = 0; t < 20; t += 0.3) { const w = idleWave(t); assert.ok(Math.abs(w.sway) <= 1 && Math.abs(w.breathe) <= 1); }
});

test("hop counts by distance, endpoints exact, squash at take-off and landing", () => {
  const a = { x: 10, y: 20 };
  const n = (d: number) => hopPath(a, { x: 10 + d, y: 20 }).filter((p) => p.squash > 0).length - 1; // landings = hops
  assert.equal(n(30), 2); assert.equal(n(240), 2); assert.equal(n(360), 3); assert.equal(n(2000), 4);
  const p = hopPath(a, { x: 410, y: 80 });
  assert.deepEqual([p[0].x, p[0].y, p[0].t], [10, 20, 0]);
  assert.deepEqual([p.at(-1)!.x, p.at(-1)!.y, p.at(-1)!.t], [410, 80, 1]);
  assert.ok(p[0].squash > 0 && p.at(-1)!.squash > 0);
  const apex = p[1]; assert.ok(apex.squash < 0 && apex.tilt > 0 && apex.y < 20 + (80 - 20) / 6);
  assert.ok(p.every((q, i) => i === 0 || q.t > p[i - 1].t));
  assert.equal(hopPath(a, { x: -400, y: 20 })[1].tilt < 0, true);
});

test("fix1: squash and drag stay bounded", () => {
  const [dx, dy] = vertexOffset(0, 0, calm({ squash: { x: 50, v: 0 }, drag: { vx: 1e9, vy: 0 } }), "stand");
  assert.ok(Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5);
  assert.ok(Math.abs(vertexOffset(0, 0, calm({ squash: { x: -50, v: 0 } }), "stand")[1]) < 0.5);
});

test("fix1: NaN-safe", () => {
  assert.deepEqual(stepSpring({ x: 1, v: 0 }, NaN), { x: 1, v: 0 });
  assert.deepEqual(kick({ x: 1, v: 2 }, NaN), { x: 1, v: 2 });
  assert.deepEqual(kick({ x: 1, v: 2 }, Infinity), { x: 1, v: 2 });
  const o = vertexOffset(NaN, NaN, calm({ sway: NaN, breathe: NaN, squash: { x: NaN, v: 0 }, drag: { vx: NaN, vy: 0 } }), "stand");
  assert.ok(o.every(Number.isFinite));
  const p = hopPath({ x: 0, y: 0 }, { x: 50, y: 5 }, NaN);
  assert.deepEqual(p.map((q) => [q.t, q.x, q.y]), [[0, 0, 0], [1, 50, 5]]);
});
