// Stage brain (Plan 19): pure spot choice, timing and body-gesture classification. No DOM; rand is injected.
import type { Expression } from "./core";
import { POSE_SPEC, type Pose } from "./poses";

export type Rect = { x: number; y: number; w: number; h: number };
/** Anchor = horizontal centre (x) and feet/bottom (y) in viewport px; flip mirrors the sprite. */
export type Spot = { pose: Pose; x: number; y: number; flip: boolean; scale: number };
export type StageEvent = "generate" | "idle" | "bored" | "sheet" | "typing";
export type SpotCtx = {
  vw: number; vh: number; mischief: number; avoid: Rect[]; targets: Rect[]; event?: StageEvent; rand: () => number;
  /** Her standing height in px (default 0.45 of vh). */
  baseH?: number;
  /** Where she is now; typing picks the nearer edge. */
  from?: { x: number; y: number };
  /** Idle/bored picks come only from these poses when any is possible (e.g. RP tab: peek/lean). */
  prefer?: Pose[];
};

/** Fraction of a peek sprite's width hidden off the edge. */
export const PEEK_HIDE = 0.4;
const STAND_H = 1216;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const rectsIntersect = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Rendered box of a spot (peek is clipped to the viewport; that visible part is what is checked against avoid). */
export function spotBox(s: Spot, baseH: number, vw: number, vh: number): Rect {
  const sp = POSE_SPEC[s.pose];
  const h = baseH * s.scale * (sp.height / STAND_H), w = (h * sp.width) / sp.height;
  const b = { x: s.x - w / 2, y: s.y - h, w, h };
  if (s.pose !== "peek") return b;
  const x0 = Math.max(0, b.x), x1 = Math.min(vw, b.x + b.w);
  return { x: x0, y: Math.max(0, b.y), w: Math.max(0, x1 - x0), h: Math.min(vh, b.y + b.h) - Math.max(0, b.y) };
}

/** Peek anchor on the left (flip false) or right edge, with PEEK_HIDE of her width off-screen. */
function peekAt(side: "l" | "r", y: number, baseH: number, vw: number, scale = 1): Spot {
  const w = (baseH * scale * POSE_SPEC.peek.width) / POSE_SPEC.peek.height;
  return { pose: "peek", x: side === "l" ? w * (0.5 - PEEK_HIDE) : vw - w * (0.5 - PEEK_HIDE), y, flip: side === "r", scale };
}

const WEIGHTS: Record<Pose, (m: number) => number> = {
  stand: (m) => 3 * (1 - m) + 1, lie: (m) => 1 + 3 * m, sit: (m) => 1 + 2 * m, legs: (m) => 0.5 + 2 * m,
  apose: (m) => 0.05 + 0.3 * m, peek: (m) => 1.2 * (1 - m) + 0.2, lean: (m) => 1, back: () => 0,
};
function pickPose(m: number, hasTarget: boolean, event: StageEvent | undefined, rand: () => number): Pose {
  if (event === "bored" && rand() < 0.7) return "legs";
  if (event === "generate") return "back";
  if (m === 0) return rand() < 0.7 ? "stand" : "peek"; // parked: only stand/peek at an edge
  const entries = (Object.keys(WEIGHTS) as Pose[]).map((p) => [p, p === "lean" && !hasTarget ? 0 : WEIGHTS[p](m)] as const);
  let r = rand() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [p, w] of entries) if ((r -= w) < 0) return p;
  return "stand";
}

/** Pick a spot + pose; never intersects ctx.avoid (falls back to the safest edge peek). */
export function chooseSpot(ctx: SpotCtx): Spot {
  const { vw, vh, avoid, targets, event, rand } = ctx;
  const baseH = ctx.baseH ?? vh * 0.45, m = clamp(ctx.mischief, 0, 10) / 10;
  const ok = (s: Spot) => { const b = spotBox(s, baseH, vw, vh); return b.y >= -0.5 && b.y + b.h <= vh + 0.5 && (s.pose === "peek" || (b.x >= -0.5 && b.x + b.w <= vw + 0.5)) && !avoid.some((a) => rectsIntersect(b, a)); };
  const peekY = (): number => vh * (0.45 + 0.5 * rand());
  const edgePeeks = (): Spot[] => (["l", "r"] as const).flatMap((sd) => [0.55, 0.7, 0.85, 1].map((f) => peekAt(sd, vh * f, baseH, vw)));
  const nearest = (to: { x: number; y: number }, rs: Rect[]) => rs.reduce<Rect | null>((best, r) => (!best || Math.hypot(r.x + r.w / 2 - to.x, r.y + r.h / 2 - to.y) < Math.hypot(best.x + best.w / 2 - to.x, best.y + best.h / 2 - to.y) ? r : best), null);

  /** Lift her above any avoid rect under her feet (e.g. a bottom composer). */
  const lift = (x: number, y: number, bw: number, h: number) => avoid.reduce((yy, a) => (a.x < x + bw / 2 && x - bw / 2 < a.x + a.w && a.y > yy - h && a.y < yy ? a.y : yy), y);
  const from = ctx.from ?? { x: vw / 2, y: vh };
  const sideNear: "l" | "r" = from.x < vw / 2 ? "l" : "r";
  for (let i = 0; i < 24; i++) {
    let s: Spot;
    if (event === "typing" || event === "sheet") s = peekAt(event === "typing" ? sideNear : rand() < 0.5 ? "l" : "r", peekY(), baseH, vw);
    else if (event === "generate") {
      const t = nearest({ x: vw / 2, y: vh / 2 }, targets), tx = t ? t.x + t.w / 2 : vw / 2;
      const sd = rand() < 0.5 ? "l" : "r", w = (baseH * POSE_SPEC.back.width) / POSE_SPEC.back.height;
      const x = sd === "l" ? w / 2 + rand() * 16 : vw - w / 2 - rand() * 16;
      s = { pose: "back", x, y: lift(x, vh, w, baseH), flip: tx < x, scale: 1 };
    } else {
      const pref = !event || event === "idle" || event === "bored" ? (ctx.prefer ?? []).filter((p) => p !== "lean" || targets.length > 0) : [];
      const pose = pref.length ? pref[Math.floor(rand() * pref.length)] : pickPose(m, targets.length > 0, event, rand);
      if (pose === "peek") s = peekAt(rand() < 0.5 ? "l" : "r", peekY(), baseH, vw);
      else {
        const sp = POSE_SPEC[pose];
        const h = baseH * (sp.height / STAND_H), bw = (h * sp.width) / sp.height;
        const left = rand() < 0.5, edgeX = left ? bw / 2 : vw - bw / 2;
        // mischief pulls her from the edge toward the centre (and onto cards)
        let x = edgeX + (vw / 2 - edgeX) * m * rand(), y = vh;
        const t = nearest({ x, y: vh / 2 }, targets);
        if (t && (pose === "sit" || pose === "legs") && rand() < m) { x = clamp(t.x + t.w * (0.2 + 0.6 * rand()), bw / 2, vw - bw / 2); y = t.y; }
        else if (t && pose === "lean") { const lft = t.x + t.w / 2 > vw / 2; x = clamp(lft ? t.x - bw * 0.25 : t.x + t.w + bw * 0.25, bw / 2, vw - bw / 2); }
        y = lift(x, y, bw, h);
        s = { pose, x, y, flip: x > vw / 2, scale: 1 };
      }
    }
    if (ok(s)) return s;
  }
  const peeks = edgePeeks(), fit = peeks.find(ok);
  if (fit) return fit;
  // nothing clear: least overlap with avoid
  const overlap = (s: Spot) => { const b = spotBox(s, baseH, vw, vh); return avoid.reduce((a, r) => a + Math.max(0, Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x)) * Math.max(0, Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y)), 0); };
  return peeks.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
}

/** Ms until her next autonomous move: 20-90 s scaled by mischief (5 = x1), never when mischief is 0. */
export function nextMoveDelay(mischief: number, rand: () => number): number {
  if (mischief <= 0) return Infinity;
  return (20 + rand() * 70) * 1000 * (1.5 - 0.1 * clamp(mischief, 0, 10));
}

/** Ms until the next blink (2.5-6 s). */
export const blinkSchedule = (rand: () => number): number => 2500 + rand() * 3500;

/** Resting expression drift: mostly smug, bored leans sleepy. */
export function idleMood(rand: () => number, bored: boolean): Expression {
  if (bored) return "sleepy";
  const mood: Expression[] = ["smug", "smug", "smug", "flirty", "wink", "sleepy"];
  return mood[Math.floor(rand() * mood.length)] ?? "smug";
}

// --- body gestures ---
/** Max total pointer travel (px) for a tap / long-press. */
export const TAP_MAX_MOVE = 10;
export const LONGPRESS_MS = 500;
/** A second tap within this window of the previous one is a poke. */
export const POKE_WINDOW_MS = 1500;
/** Tap in the top fraction of her box is a pat. */
export const PAT_ZONE = 0.2;
/** Release speed (px/ms, measured over the last FLICK_WINDOW_MS) above which a drag is a flick. */
export const FLICK_SPEED = 0.8;
export const FLICK_WINDOW_MS = 80;
/** Look-ahead (ms) for the flick's projected landing point. */
export const FLICK_PROJECT_MS = 300;

export type PointerSample = { x: number; y: number; t: number };
export type BodyGesture = "poke" | "pat" | "drag" | "flick" | "swipeOff" | "menu" | "longpress";
export type GestureCtx = { box: Rect; vw: number; vh: number; lastTapAt: number | null };

/** Classify a pointer track on her body (down..up, or down..now for long-press detection). */
export function classifyBodyGesture(samples: PointerSample[], ctx: GestureCtx): BodyGesture | null {
  if (samples.length < 1) return null;
  const a = samples[0], z = samples[samples.length - 1];
  const travel = Math.max(...samples.map((p) => Math.hypot(p.x - a.x, p.y - a.y)));
  if (travel <= TAP_MAX_MOVE) {
    if (z.t - a.t >= LONGPRESS_MS) return "longpress";
    if (a.y < ctx.box.y + ctx.box.h * PAT_ZONE) return "pat";
    return ctx.lastTapAt !== null && z.t - ctx.lastTapAt <= POKE_WINDOW_MS ? "poke" : "menu";
  }
  const w = samples.find((p) => p.t >= z.t - FLICK_WINDOW_MS && p !== z) ?? a, dt = z.t - w.t;
  const vx = dt > 0 ? (z.x - w.x) / dt : 0, vy = dt > 0 ? (z.y - w.y) / dt : 0;
  if (Math.hypot(vx, vy) <= FLICK_SPEED) return "drag";
  const lx = z.x + vx * FLICK_PROJECT_MS, ly = z.y + vy * FLICK_PROJECT_MS;
  return lx < 0 || lx > ctx.vw || ly < 0 || ly > ctx.vh ? "swipeOff" : "flick";
}

/** Rects worth avoiding/targeting: non-empty and at least partly inside the viewport. */
export const onScreen = (rs: Rect[], vw: number, vh: number): Rect[] =>
  rs.filter((r) => r.w > 0 && r.h > 0 && r.x < vw && r.x + r.w > 0 && r.y < vh && r.y + r.h > 0);

/** Where a dropped/thrown Miyabi settles: feet near `drop`, lie when low, sit on a card's top edge, else stand; clear of avoid. `can` = poses that have a sprite. */
export function settleSpot(drop: { x: number; y: number }, ctx: Omit<SpotCtx, "mischief" | "event" | "from">, can: (p: Pose) => boolean): Spot {
  const { vw, vh, avoid, targets } = ctx, baseH = ctx.baseH ?? vh * 0.45;
  const card = targets.find((t) => Math.abs(drop.y - t.y) < 48 && drop.x >= t.x && drop.x <= t.x + t.w);
  const first: Pose = drop.y > vh * 0.85 ? "lie" : card ? "sit" : "stand";
  for (const pose of [...new Set<Pose>([first, "stand", "sit", "lie"])].filter(can)) for (const dy of [0, -48, 48, -96, 96, -192, 192, -320]) {
    const sp = POSE_SPEC[pose], h = baseH * (sp.height / STAND_H), w = (h * sp.width) / sp.height;
    const x = clamp(drop.x, w / 2, vw - w / 2), y = clamp((pose === "sit" && card ? card.y : drop.y) + dy, h, vh);
    const s: Spot = { pose, x, y, flip: x > vw / 2, scale: 1 };
    if (!avoid.some((a) => rectsIntersect(spotBox(s, baseH, vw, vh), a))) return s;
  }
  return chooseSpot({ ...ctx, mischief: 0, from: drop });
}

/** After a resize: the same spot (same object) if still fine, nudged back on-screen if it drifted off, null = she'd cover an avoid rect, re-pick. */
export function refitSpot(s: Spot, baseH: number, vw: number, vh: number, avoid: Rect[]): Spot | null {
  const sp = POSE_SPEC[s.pose], h = baseH * s.scale * (sp.height / STAND_H), w = (h * sp.width) / sp.height;
  const x = s.pose === "peek" ? s.x : clamp(s.x, w / 2, vw - w / 2), y = clamp(s.y, Math.min(h, vh), vh);
  const t = x === s.x && y === s.y ? s : { ...s, x, y };
  return avoid.some((a) => rectsIntersect(spotBox(t, baseH, vw, vh), a)) ? null : t;
}
