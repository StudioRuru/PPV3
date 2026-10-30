import { test } from "node:test";
import assert from "node:assert/strict";
import { END, handMask, idleUniforms, newWave, RIGS, startWave, waveStep, type Quirks } from "./rig";

const rig = RIGS.day!;
const run = (from: number, to: number, s = newWave(), dt = 1 / 60) => {
  const out: { t: number; w: ReturnType<typeof waveStep> }[] = [];
  for (let t = from; t <= to; t += dt) out.push({ t, w: waveStep(s, t, dt, rig) });
  return { s, out };
};

test("startWave ignores a running wave", () => {
  const s = newWave();
  assert.equal(startWave(s, 0), true);
  assert.equal(startWave(s, 1), false);
  for (let t = 0; t < END + 0.1; t += 1 / 60) waveStep(s, t, 1 / 60, rig);
  assert.equal(startWave(s, END + 0.2), true);
});

test("wave envelope", () => {
  const s = newWave();
  startWave(s, 0);
  const { out } = run(0, END + 1.2, s);
  const at = (t: number) => out.find((o) => o.t >= t)!.w;
  assert.equal(at(0.05).mixT, 0);
  assert.ok(at(1.5).mixT > 0.99);
  assert.equal(at(END + 0.05).mixT, 0);
  assert.equal(s.at, null);
  assert.ok(Math.max(...out.map((o) => Math.abs(o.w.hA))) <= 0.35); // spike constants overshoot to ~0.33 rad
  assert.ok(Math.abs(s.hand.x) < 0.01);
});

test("wave flicks spawn only while held", () => {
  const s = newWave();
  startWave(s, 0);
  const flicks = run(0, END, s).out.filter((o) => o.w.flick);
  assert.ok(flicks.length >= 6, `got ${flicks.length}`);
  assert.ok(flicks.every((o) => o.w.mixT > 0.9));
});

test("waveStep with a huge dt stays bounded", () => {
  const s = newWave();
  startWave(s, 0);
  const w = waveStep(s, 1, 5, rig);
  assert.ok(Number.isFinite(w.hA) && Math.abs(w.hA) < 1);
});

test("idle uniforms are bounded", () => {
  const q: Quirks = { blink: 10, ear: 10, tilt: 10, flick: 10, sway: 10 };
  const s = newWave();
  for (let t = 0; t <= 60; t += 1 / 30) {
    const u = idleUniforms(t, q, waveStep(s, t, 1 / 30, rig));
    assert.ok(Math.abs(u.sway) < 2 && Math.abs(u.tilt) < 0.25 && Math.abs(u.hair) < 3);
    assert.ok(u.blink >= 0 && u.blink <= 1);
  }
});

const W = rig.w, H = rig.h;
const square = (px: Uint8ClampedArray, cx: number, cy: number, r: number) => {
  for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) px.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 4);
};

test("handMask grabs the hand only", () => {
  const px = new Uint8ClampedArray(W * H * 4);
  square(px, rig.seed[0], rig.seed[1], 20);
  square(px, 600, 1200, 20);
  const m = handMask(px, rig);
  assert.equal(m[rig.seed[1] * W + rig.seed[0]], 255);
  assert.equal(m[1200 * W + 600], 0);
  const n = m.reduce((a, v) => a + (v ? 1 : 0), 0);
  assert.ok(n >= 1600 && n <= 2000, `got ${n}`);
});

test("handMask on a blank image is empty", () => {
  assert.equal(handMask(new Uint8ClampedArray(W * H * 4), rig).reduce((a, v) => a + v, 0), 0);
});
