import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelThink, cancelWave, END, waveReady, hairMask, handMask, idleUniforms, newThink, newWave, RIGS, startThink, startWave, stopThink, THINK_MIN, thinkStep, WALK_FPS, walkBob, walkFrame, walkSpeed, waveStep, queuedWave, walkSettle, WAVE_QUEUE_S, type Quirks } from "./rig";

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

test("handMask finds the hand in the shipped wave still", async () => {
  const sharp = (await import("sharp")).default;
  const { data } = await sharp("public/rig/day/wave.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = handMask(new Uint8ClampedArray(data), rig).reduce((a, v) => a + (v ? 1 : 0), 0);
  assert.ok(n > 500, `got ${n}`); // the seed sits on line art, as in the spike
});

test("cancelWave drops a half-done wave so the next frame is at rest", () => {
  const s = newWave();
  startWave(s, 0);
  run(0, 1, s);
  cancelWave(s);
  const w = waveStep(s, 2.5, 1 / 60, rig);
  assert.equal(w.mixT, 0);
  assert.ok(Math.abs(w.hA) < 1e-9);
  assert.equal(startWave(s, 2.6), true);
});

test("hairMask takes dark hair beside the arm, never skin or the arm's line art", () => {
  const px = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: number[]) => px.set(c, (y * W + x) * 4);
  for (let y = 400; y < 500; y++) for (let x = 150; x < 280; x++) put(x, y, x < 240 ? [90, 90, 100, 255] : x === 240 ? [36, 31, 62, 255] : [251, 192, 191, 255]);
  const m = hairMask(px, rig);
  assert.equal(m[450 * W + 200], 255); // hair
  assert.equal(m[450 * W + 260], 0); // skin
  assert.equal(m[450 * W + 240], 0); // arm outline next to skin
  assert.ok(m[450 * W + 135] > 0); // grown into the empty background so tips can swing out
  assert.equal(m[450 * W + 600], 0); // outside the hair region
});

test("idle breath leaves the knee dip to its own channel", () => {
  const q: Quirks = { blink: -Infinity, ear: -Infinity, tilt: -Infinity, flick: -Infinity, sway: -Infinity };
  const w = { mixT: 0, hA: 0, bob: -1, act: 0, lag: 0, earKick: false, flick: null };
  const u = idleUniforms(0, q, w), r = idleUniforms(0, q, { ...w, bob: 0 });
  assert.equal(u.breath, r.breath);
  assert.equal(u.dip, -1);
});

test("shipped walk and think stills are keyed like rest", async () => {
  const sharp = (await import("sharp")).default;
  for (const f of ["walk1", "walk2", "walk3", "walk4", "think"]) {
    const { data, info } = await sharp(`public/rig/day/${f}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 768, f);
    assert.equal(info.height, 1344, f);
    const a = (x: number, y: number) => data[(y * 768 + x) * 4 + 3];
    assert.equal(a(2, 2) + a(765, 2) + a(2, 1341), 0, `${f} corners`);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
    const frac = n / (768 * 1344);
    assert.ok(frac > 0.15 && frac < 0.35, `${f} opaque ${frac}`);
  }
});

test("walkFrame cycles at WALK_FPS", () => {
  assert.equal(walkFrame(0), 0);
  assert.equal(walkFrame(1.01 / WALK_FPS), 1);
  assert.equal(walkFrame(3.5 / WALK_FPS), 3);
  assert.equal(walkFrame(4.2 / WALK_FPS), 0);
  assert.equal(walkFrame(-1), 0);
});

test("walkBob peaks on passing frames", () => {
  assert.ok(Math.abs(walkBob(1.5 / WALK_FPS) - 0.35) < 1e-9);
  assert.ok(Math.abs(walkBob(3.5 / WALK_FPS) - 0.35) < 1e-9);
  assert.ok(Math.abs(walkBob(0.5 / WALK_FPS) + 0.35) < 1e-9);
  for (let t = 0; t <= 3; t += 0.01) assert.ok(Math.abs(walkBob(t)) <= 0.35 + 1e-9);
});

test("walkSpeed keeps feet planted", () => {
  assert.equal(walkSpeed(rig, 336), (130 * 7 * 336) / 1344);
});

const FADE = 0.14, IN = 0.12;
const steps = (s: ReturnType<typeof newThink>, from: number, to: number) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += 1 / 60) out.push({ t, ...thinkStep(s, t) });
  return out;
};

test("think dissolves in, holds with dots, then out", () => {
  const s = newThink();
  startThink(s, 0);
  const a = steps(s, 0, 0.5);
  assert.equal(a.find((f) => f.t >= 0.05)!.mixT, 0);
  const last = a[a.length - 1];
  assert.ok(last.mixT > 0.99);
  assert.ok(last.dots >= 1 && last.dots <= 3);
  steps(s, 0.5, 2);
  stopThink(s, 2);
  const b = steps(s, 2, 2 + FADE + 0.5);
  assert.equal(b.find((f) => f.t >= 2 + FADE + 0.01)!.mixT, 0);
  assert.equal(b.filter((f) => f.done).length, 1);
  assert.equal(s.at, null);
});

test("stopThink before the minimum hold waits", () => {
  const s = newThink();
  startThink(s, 0);
  steps(s, 0, 0.1);
  stopThink(s, 0.1);
  assert.ok(thinkStep(s, IN + FADE + THINK_MIN - 0.05).mixT > 0.99);
  assert.equal(thinkStep(s, IN + 2 * FADE + THINK_MIN + 0.01).mixT, 0);
});

test("cancelThink drops the pose but keeps want", () => {
  const s = newThink();
  startThink(s, 0);
  steps(s, 0, 0.5);
  cancelThink(s);
  assert.equal(thinkStep(s, 0.52).mixT, 0);
  assert.equal(s.want, true);
  startThink(s, 1);
  assert.equal(thinkStep(s, 1.05).mixT, 0);
  assert.equal(s.at, 1);
});

test("startThink while thinking does not restart", () => {
  const s = newThink();
  startThink(s, 0);
  startThink(s, 0.5);
  assert.equal(s.at, 0);
});

test("waveReady holds a wave through a walk or think and frees it after", () => {
  const s = newThink();
  assert.equal(waveReady(true, s), false); // mid-walk: queue, never drop
  startThink(s, 0);
  assert.equal(waveReady(false, s), false);
  stopThink(s, 0.1);
  for (let t = 0; t < 3; t += 1 / 60) thinkStep(s, t);
  assert.equal(waveReady(false, s), true);
  s.want = true; // a new render queued: its think goes first
  assert.equal(waveReady(false, s), false);
});

test("queuedWave plays when free, holds a render's wave, and drops a stale pat", () => {
  const s = newThink();
  assert.equal(queuedWave(5, 1, false, s), "play");
  assert.equal(queuedWave(5, 1, true, s), "keep");
  assert.equal(queuedWave(5, 6, true, s), "drop"); // a pat from mid-walk is old news
  assert.equal(queuedWave(Infinity, 999, true, s), "keep"); // the done-rendering wave waits it out
  assert.equal(queuedWave(5, 6, false, s), "drop");
  assert.ok(WAVE_QUEUE_S >= 2 && WAVE_QUEUE_S <= 4);
});

test("walkSettle eases the step bob out instead of snapping", () => {
  assert.equal(walkSettle(0.35, 0), 0.35);
  const mid = walkSettle(0.35, 0.05);
  assert.ok(mid > 0 && mid < 0.35);
  assert.equal(walkSettle(0.35, 0.2), 0);
  assert.equal(Math.abs(walkSettle(-0.35, 1)), 0);
});
