// Mascot warp math (Plan 22): pure CPU twin of the vertex shader, plus springs and hop paths. SpriteCanvas feeds its uniforms from WARP.
import type { Pose } from "./poses";

/** Band edges (normalised sprite space, y=0 top), amplitudes (normalised units) and periods (s). Tunable; the shader reads these. */
export const WARP = {
  head: { edge: 0.3 }, chest: { from: 0.3, to: 0.55 },
  swayAmp: 0.026, swayPeriod: 4, // ~±1.5° shear at the top of a head band
  breatheAmp: 0.012, breathePeriod: 3.5,
  dragGain: 0.05, dragMax: 1,
  xBandPoses: ["lie", "sit"] as readonly Pose[], xBandAmp: 0.6, // lie/sit: bands run along x (head on the right), reduced amplitude
  xHead: 0.7, xChest: { from: 0.45, to: 0.7 },
  spring: { k: 120, c: 10, maxDt: 1 / 30, sub: 4 }, // damping ratio ~0.46
  squashMax: 0.4, squashShift: 0.5, // sideways bulge per unit squash (volume keeping)
} as const;

export type Spring = { x: number; v: number };
export type WarpState = { t: number; sway: number; breathe: number; squash: Spring; drag: { vx: number; vy: number } };
export type Band = { band: "head" | "chest" | "none"; weight: number };

/** Idle sine drivers in -1..1 for time t (seconds). */
export const idleWave = (t: number): { sway: number; breathe: number } =>
  ({ sway: Math.sin((2 * Math.PI * t) / WARP.swayPeriod), breathe: Math.sin((2 * Math.PI * t) / WARP.breathePeriod) });

/** Does this pose put its bands along x instead of y? */
export const usesXBands = (pose: Pose): boolean => WARP.xBandPoses.includes(pose);

/** Band at coordinate c (v for upright poses, u for lie/sit) with a 0..1 weight that ramps to 0 at the band edge; amplitude reduction is applied by vertexOffset. */
export function bandFor(pose: Pose, c: number): Band {
  if (usesXBands(pose)) {
    const { xHead, xChest: ch } = WARP;
    if (c > xHead) return { band: "head", weight: Math.min(1, (c - xHead) / (1 - xHead)) };
    if (c >= ch.from && c < ch.to) return { band: "chest", weight: 1 - Math.abs(c - (ch.from + ch.to) / 2) / ((ch.to - ch.from) / 2) };
    return { band: "none", weight: 0 };
  }
  if (c < WARP.head.edge) return { band: "head", weight: 1 - c / WARP.head.edge };
  const { from, to } = WARP.chest;
  if (c >= from && c < to) return { band: "chest", weight: 1 - Math.abs(c - (from + to) / 2) / ((to - from) / 2) };
  return { band: "none", weight: 0 };
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Displacement [dx, dy] of the vertex at (u, v) in normalised units: band sway/breathe/drag plus whole-body squash about the feet. */
export function vertexOffset(u0: number, v0: number, s: WarpState, pose: Pose): [number, number] {
  const u = fin(u0), v = fin(v0), sway = clamp(fin(s.sway), -1, 1), breathe = clamp(fin(s.breathe), -1, 1);
  const xb = usesXBands(pose), { band, weight } = bandFor(pose, xb ? u : v), amp = xb ? WARP.xBandAmp : 1;
  let dx = 0, dy = 0;
  if (band === "head") {
    const lag = clamp(fin(s.drag.vx), -WARP.dragMax, WARP.dragMax) * WARP.dragGain;
    dx = (sway * WARP.swayAmp - lag) * weight * amp; // top band shears opposite to drag
  } else if (band === "chest") dy = -breathe * WARP.breatheAmp * weight * amp;
  const q = clamp(fin(s.squash.x), -WARP.squashMax, WARP.squashMax); // + = squash (shorter, wider), - = stretch
  dy -= (1 - v) * q; dx += (u - 0.5) * q * WARP.squashShift;
  return [dx, dy];
}

/** A spring with any non-finite part (NaN, overflow) resets to rest. */
const sane = (sp: Spring): Spring => (Number.isFinite(sp.x) && Number.isFinite(sp.v) ? sp : { x: 0, v: 0 });

/** Add an impulse (velocity) to a spring. */
export const kick = (sp: Spring, impulse: number): Spring => sane({ x: sp.x, v: sp.v + fin(impulse) });

/** Damped spring toward 0, semi-implicit Euler in sub-steps; dt is clamped so a stalled frame can't explode it. */
export function stepSpring(sp: Spring, dt: number): Spring {
  const { k, c, maxDt, sub } = WARP.spring, h = clamp(fin(dt), 0, maxDt) / sub;
  let { x, v } = sane(sp);
  for (let i = 0; i < sub; i++) { v += (-k * x - c * v) * h; x += v * h; }
  return sane({ x, v });
}

export type Hop = { t: number; x: number; y: number; squash: number; tilt: number };
const HOP_PX = 120, HOP_SQUASH = 0.15, HOP_STRETCH = -0.08, HOP_TILT = 0.08;

/** 2–4 hops from→to (count by distance, default hypot); keyframes at take-off/apex/landing, endpoints exact, y up = negative. */
export function hopPath(from: { x: number; y: number }, to: { x: number; y: number }, dist = Math.hypot(to.x - from.x, to.y - from.y)): Hop[] {
  const ok = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!ok(from) || !ok(to)) return [from, to].filter(ok).map((p) => ({ t: 0, x: p.x, y: p.y, squash: 0, tilt: 0 })); // no hops, just the finite point
  if (!Number.isFinite(dist)) return [{ t: 0, ...from, squash: 0, tilt: 0 }, { t: 1, ...to, squash: 0, tilt: 0 }];
  const n = clamp(Math.round(dist / HOP_PX), 2, 4), lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const lift = clamp((dist / n) * 0.4, 8, 48), lean = Math.sign(to.x - from.x) * HOP_TILT;
  const out: Hop[] = [{ t: 0, x: from.x, y: from.y, squash: HOP_SQUASH, tilt: 0 }];
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    out.push({ t: (i + 0.5) / n, x: lerp(from.x, to.x, (i + 0.5) / n), y: lerp(from.y, to.y, (i + 0.5) / n) - lift, squash: HOP_STRETCH, tilt: lean });
    out.push({ t: (i + 1) / n, x: last ? to.x : lerp(from.x, to.x, (i + 1) / n), y: last ? to.y : lerp(from.y, to.y, (i + 1) / n), squash: HOP_SQUASH, tilt: 0 });
  }
  return out;
}
