import type { Spring } from "./anim";
import type { Outfit } from "./core";

/** A live rig over one exact still: every coordinate is in that still's pixels. Values tuned in the Stage rig spike. */
export type Rig = {
  w: number; h: number; rest: string; wave: string;
  P: [number, number]; D: [number, number]; tip: [number, number]; seed: [number, number];
  amp: number; hz: number;
};

/** Only the day standing still (Sprites base 114) is rigged; other outfits keep SpriteCanvas. */
export const RIGS: Partial<Record<Outfit, Rig>> = {
  day: { w: 768, h: 1344, rest: "/rig/day/rest.png", wave: "/rig/day/wave.png", P: [268, 342], D: [-0.35, -0.94], tip: [238, 252], seed: [248, 300], amp: 0.22, hz: 2.1 },
};

const HOLD = 2.6, FADE = 0.14, IN = 0.12;
export const END = IN + 2 * FADE + HOLD + 0.45;

const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** sin² bump over one quirk's length; 0 outside it. */
const ease = (t: number) => (t < 0 || t > 1 ? 0 : Math.sin(Math.PI * t) ** 2);
/** The arm swap happens at the bottom of a little knee dip, then she bounces up. */
const dip = (x: number) => (x < 0 ? 0 : x < 0.25 ? -Math.sin((Math.PI * x) / 0.25) : x < 0.45 ? 0.35 * Math.sin((Math.PI * (x - 0.25)) / 0.2) : 0);

export function spring(s: Spring, target: number, hz: number, damp: number, dt: number): void {
  const k = (2 * Math.PI * hz) ** 2;
  s.v += (k * (target - s.x) - 2 * damp * Math.sqrt(k) * s.v) * dt;
  s.x += s.v * dt;
}

export type WaveState = { at: number | null; hand: Spring; lag: Spring };
export const newWave = (): WaveState => ({ at: null, hand: { x: 0, v: 0 }, lag: { x: 0, v: 0 } });

export function startWave(s: WaveState, now: number): boolean {
  if (s.at !== null) return false;
  s.at = now;
  return true;
}

/** A hidden tab cancels the wave: its clock is wall time, so resuming would land mid-pose with no dip to hide the swap. */
export function cancelWave(s: WaveState): void {
  s.at = null;
  s.hand.x = s.hand.v = s.lag.x = s.lag.v = 0;
}

export type WaveFrame = { mixT: number; hA: number; bob: number; act: number; lag: number; earKick: boolean; flick: [number, number] | null };

/** Knee dip, dissolve to the wave still at its bottom, spring-driven wrist wag, dip again to dissolve out. */
export function waveStep(s: WaveState, now: number, dt: number, rig: Rig): WaveFrame {
  dt = Math.min(Math.max(dt, 0), 1 / 30);
  const pt = s.at === null ? -1 : now - s.at, on = s.at !== null && pt < END, out = IN + FADE + HOLD;
  if (!on) s.at = null;
  const mixT = on ? sm((pt - IN) / FADE) * sm((out + FADE - pt) / FADE) : 0;
  const ts = pt - IN - FADE;
  const target = on ? rig.amp * Math.tanh(2.2 * Math.sin(ts * 2 * Math.PI * rig.hz)) * sm(ts / 0.2) * sm((HOLD - 0.1 - ts) / 0.3) : 0;
  const lastV = s.hand.v;
  spring(s.hand, target, 4.2, 0.3, dt);
  spring(s.lag, s.hand.x, 2, 0.45, dt);
  const bob = on ? dip(pt - IN - FADE / 2 + 0.125) + dip(pt - out - FADE / 2 + 0.125) : 0;
  let flick: [number, number] | null = null;
  if (on && mixT > 0.9 && ts < HOLD - 0.4 && Math.sign(s.hand.v) !== Math.sign(lastV)) {
    const a = s.hand.x, [px, py] = rig.P, dx = rig.tip[0] - px, dy = rig.tip[1] - py;
    flick = [px + Math.cos(a) * dx - Math.sin(a) * dy, py + Math.sin(a) * dx + Math.cos(a) * dy];
  }
  return { mixT, hA: s.hand.x, bob, act: on ? mixT : 0, lag: s.lag.x, earKick: on && pt > IN && pt - dt <= IN, flick };
}

/** Start time of each one-shot quirk (-Infinity = never). */
export type Quirks = { blink: number; ear: number; tilt: number; flick: number; sway: number };
export const QUIRK_LEN: Quirks = { blink: 0.18, ear: 0.5, tilt: 2.6, flick: 1.8, sway: 3.2 };

/** Idle layers plus the body answering the hand a beat late: head leans in, shoulders rock, a bob at each swing end. */
export function idleUniforms(t: number, q: Quirks, w: WaveFrame) {
  const e = (k: keyof Quirks) => (t - q[k]) / QUIRK_LEN[k];
  const ear = e("ear"), flick = e("flick"), blink = e("blink"), inside = (x: number) => x > 0 && x < 1;
  return {
    breath: Math.sin((t * 2 * Math.PI) / 3.6) - w.act * Math.abs(w.lag) * 2.5,
    dip: w.bob,
    sway: Math.sin(t * 0.7) * 0.25 + ease(e("sway")) * 0.9 + w.act * w.lag * 2.2,
    tilt: Math.sin(t * 0.45) * 0.012 + ease(e("tilt")) * 0.1 + w.act * 0.07 + w.lag * 0.05,
    earL: inside(ear) ? Math.sin(ear * Math.PI * 4) * 0.12 * (1 - ear) : 0,
    earR: Math.sin(t * 0.9) * 0.015 + (inside(ear) ? Math.sin(ear * Math.PI * 4 + 0.6) * 0.1 * (1 - ear) : 0),
    hair: Math.sin(t * 1.3) * 0.35 + Math.sin(t * 0.53) * 0.25 + (inside(flick) ? Math.sin(flick * Math.PI * 3) * Math.exp(-flick * 3) * 2.2 : 0),
    blink: inside(blink) ? Math.sin(Math.PI * blink) : 0,
  };
}

/** Hand layer: flood-fill the light skin/cuff pixels from the palm inside the hand's box, then grow 2px to take the line art. */
export function handMask(px: Uint8ClampedArray, rig: Rig): Uint8Array {
  const { w: W, h: H, P, D } = rig, m = new Uint8Array(W * H);
  const ok = (i: number) => {
    const X = (i % W) - P[0], Y = ((i / W) | 0) - P[1], al = X * D[0] + Y * D[1], pe = Math.abs(-X * D[1] + Y * D[0]);
    return al > -6 && al < 130 && pe < 70 && px[i * 4 + 3] > 128 && px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 450;
  };
  const seed = rig.seed[0] + rig.seed[1] * W; // may sit on line art: it is taken as is, like the spike
  const st = [seed];
  m[seed] = 1;
  let filled = 0;
  const nb = (i: number) => {
    const x = i % W;
    return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].filter((n) => n >= 0 && n < W * H);
  };
  while (st.length) for (const n of nb(st.pop()!)) if (!m[n] && ok(n)) { m[n] = 1; st.push(n); filled++; }
  if (!filled) return new Uint8Array(W * H);
  let g = m;
  for (let k = 0; k < 2; k++) {
    const n = g.slice();
    for (let i = 0; i < g.length; i++) if (!g[i] && nb(i).some((j) => g[j])) n[i] = 1;
    g = n;
  }
  for (let i = 0; i < g.length; i++) g[i] *= 255;
  return g;
}

/** Hanging hair on her left: dark pixels in the hair strip that are not skin or the arm's outline, grown 20px into the empty
 *  background so the tips have room to swing. Day still only (Sprites base 114); the box is in its pixels. */
export function hairMask(px: Uint8ClampedArray, rig: Rig): Uint8Array {
  const W = rig.w, X1 = 300, Y0 = 240, Y1 = 900, GROW = 20;
  const inBox = (x: number, y: number) => y >= Y0 && y < Y1 && x < (y > 680 ? 282 : X1);
  const a = (i: number) => px[i * 4 + 3];
  let body = new Uint8Array(W * rig.h);
  for (let y = Y0 - 4; y < Y1 + 4; y++) for (let x = 0; x < X1 + 4; x++) {
    const i = y * W + x;
    if (a(i) > 128 && px[i * 4] > 200 && px[i * 4] > px[i * 4 + 2]) body[i] = 1;
  }
  const grow = (g: Uint8Array, ok: (x: number, y: number, i: number) => boolean) => {
    const n = g.slice();
    for (let y = Y0; y < Y1; y++) for (let x = 1; x < X1 + 3; x++) {
      const i = y * W + x;
      if (!g[i] && ok(x, y, i) && (g[i - 1] || g[i + 1] || g[i - W] || g[i + W])) n[i] = 1;
    }
    return n;
  };
  for (let k = 0; k < 3; k++) body = grow(body, () => true); // take the arm's line art with the skin
  let m = new Uint8Array(W * rig.h);
  for (let y = Y0; y < Y1; y++) for (let x = 0; x < X1; x++) {
    const i = y * W + x;
    if (inBox(x, y) && a(i) > 40 && !body[i]) m[i] = 1;
  }
  for (let k = 0; k < GROW; k++) m = grow(m, (x, y, i) => inBox(x, y) && a(i) === 0);
  for (let i = 0; i < m.length; i++) m[i] *= 255;
  return m;
}
