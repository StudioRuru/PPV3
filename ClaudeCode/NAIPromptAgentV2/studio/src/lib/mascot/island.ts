// Liquid island navigation: pure logic. Numbers come from the owner's SwiftUI sample (CSS px == pt on iOS).

export type IslandState = "minimal" | "compact" | "expanded";
export type IslandEvent = "tap" | "expand" | "collapse" | "peek" | "timeout";
export type IslandGesture = "swipeLeft" | "swipeRight" | "down" | "up" | "tap" | "longpress";
export type Size = { w: number; h: number };
/** Settings → Mascot → Island: offsets from the sample's anchor (x = centre shift, y = top shift, w/h = size). */
export type Calibration = { x: number; y: number; w: number; h: number };

export const ANCHOR = { w: 126, h: 37.33, top: 11 };
/** No Dynamic Island: a small dark pill this far below the top inset. */
export const PILL = { w: 110, h: 26, gap: 6 };
export const HOT = { w: 180, h: 65 };
export const EXPANDED: Size = { w: 340, h: 150 };
export const CORNER = 32;
const COMPACT = { w: 64, h: 36 }; // compact grows this much past the anchor
/** Drag: finger × down/up factor; drawer grows w × 1.6, h × 0.9 of that; release > expand opens, < collapse closes; content shows past `content`. */
export const DRAG = { down: 0.65, up: 0.4, w: 1.6, h: 0.9, expand: 55, collapse: -30, content: 40 };
export const SPRING = { response: 0.45, damping: 0.72 };
export const TAP_SLOP = 10, LONG_MS = 500, SWIPE_MIN = 40;
export const CAL_BOUNDS: Record<keyof Calibration, [number, number]> = { x: [-40, 40], y: [-40, 40], w: [-40, 60], h: [-40, 60] };
export const CAL_ZERO: Calibration = { x: 0, y: 0, w: 0, h: 0 };

/** A top safe-area inset taller than 50 means a Dynamic Island (notch phones are ~47, others 0–20). */
export const hasIsland = (topInsetPx: number) => topInsetPx > 50;

export function nextState(s: IslandState, e: IslandEvent): IslandState {
  switch (e) {
    case "tap": return s === "expanded" ? "compact" : "expanded";
    case "expand": return "expanded";
    case "collapse": return "minimal";
    case "peek": return s === "minimal" ? "compact" : s;
    case "timeout": return s === "compact" ? "minimal" : s;
  }
}

/** Finger travel → the sample's drag amount (down 0.65, up 0.4). */
export const dragAmount = (dy: number) => dy * (dy > 0 ? DRAG.down : DRAG.up);

/** On release. null = nothing (springs back). Long-press is also fired live by a timer. */
export function classifyIslandGesture({ dx, dy, ms }: { dx: number; dy: number; ms: number }): IslandGesture | null {
  if (Math.hypot(dx, dy) <= TAP_SLOP) return ms >= LONG_MS ? "longpress" : "tap";
  if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx < 0 ? "swipeLeft" : "swipeRight";
  const d = dragAmount(dy);
  return d > DRAG.expand ? "down" : d < DRAG.collapse ? "up" : null;
}

/** Swipe left → next tab, right → previous; null at the ends (no wrap, like the edge-swipe). */
export function swipeTab<T>(tabs: readonly T[], cur: T, g: IslandGesture | null): T | null {
  const i = tabs.indexOf(cur) + (g === "swipeLeft" ? 1 : g === "swipeRight" ? -1 : 0);
  return i !== tabs.indexOf(cur) ? tabs[i] ?? null : null;
}

/** The black anchor: behind the real island (calibrated), or a plain pill below the inset. x = shift from centre. */
export function anchorBox(cal: Calibration, island: boolean, topInset: number) {
  return island ? { x: cal.x, top: ANCHOR.top + cal.y, w: ANCHOR.w + cal.w, h: ANCHOR.h + cal.h }
    : { x: 0, top: topInset + PILL.gap, w: PILL.w, h: PILL.h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const maxSize = (vw: number): Size => ({ w: Math.min(EXPANDED.w, vw - 16), h: EXPANDED.h });

/** Drawer size at rest: minimal = hidden inside the anchor, compact = a strip below it, expanded = the sample's 340×150. */
export function drawerSize(s: IslandState, anchor: Size, vw: number): Size {
  const max = maxSize(vw);
  if (s === "minimal") return { w: anchor.w, h: anchor.h };
  if (s === "compact") return { w: Math.min(anchor.w + COMPACT.w, max.w), h: anchor.h + COMPACT.h };
  return { w: Math.max(max.w, anchor.w), h: Math.max(max.h, anchor.h) };
}

/** Live drawer while dragging from `base` (the sample caps growth at +214/+110, i.e. the expanded size from the anchor). */
export function dragSize(base: Size, anchor: Size, max: Size, drag: number): Size {
  return { w: clamp(base.w + drag * DRAG.w, anchor.w, max.w), h: clamp(base.h + drag * DRAG.h, anchor.h, max.h) };
}

/** The toggle's hit area (centred, from y = 0): the sample's 180×65 over the island (pill + 6 px without one), the whole compact strip,
 *  and only the anchor's band when expanded so it never covers the content below (which starts at a.top + a.h + 4). */
export function hotRect(s: IslandState, island: boolean, a: { top: number; h: number }, rest: Size): Size {
  if (s === "compact") return { w: Math.max(HOT.w, rest.w), h: a.top + rest.h };
  if (s === "expanded") return { w: HOT.w, h: a.top + a.h };
  return { w: HOT.w, h: island ? Math.max(HOT.h, a.top + a.h) : a.top + a.h + 6 };
}

/** Touch strip on island phones: iOS never delivers touches on the real island or the status bar around it, so the hit area sits this far below the top inset. */
export const STRIP = { w: HOT.w, h: 44, gap: 2 };

/** Where the toggle actually sits (x = centre shift, top in px). Island: a 180×44 strip just below the cutout (calibration x/w and a downward y move it; y < 0 is ignored, it would enter the dead inset),
 *  grown to cover the compact strip; expanded keeps hotRect's band so it never covers the panel controls. No island: hotRect from y = 0. */
export function touchRect(s: IslandState, topInset: number, cal: Calibration, a: { x: number; top: number; h: number }, rest: Size) {
  if (!hasIsland(topInset) || s === "expanded") return { x: a.x, top: 0, ...hotRect(s, hasIsland(topInset), a, rest) };
  const top = topInset + STRIP.gap + Math.max(0, cal.y), w = STRIP.w + cal.w;
  return s === "compact" ? { x: cal.x, top, w: Math.max(w, rest.w), h: Math.max(STRIP.h, a.top + rest.h - top) } : { x: cal.x, top, w, h: STRIP.h };
}

export const contentVisible = (s: IslandState, drag: number) => s === "expanded" || drag > DRAG.content;

/** Untrusted calibration patch onto cur: each field kept only if a finite number within CAL_BOUNDS. */
export function mergeCalibration(cur: Calibration, patch: unknown): Calibration {
  if (!patch || typeof patch !== "object") return cur;
  const p = patch as Record<string, unknown>, out = { ...cur };
  for (const k of Object.keys(CAL_BOUNDS) as (keyof Calibration)[]) {
    const v = p[k], [lo, hi] = CAL_BOUNDS[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

/** SwiftUI-style spring (response, damping fraction) as a CSS linear() easing + duration until it settles within 0.5%. */
export function springEasing(response = SPRING.response, damping = SPRING.damping, n = 32): { easing: string; ms: number } {
  const w = (2 * Math.PI) / response, wd = w * Math.sqrt(1 - damping ** 2), k = damping * w;
  const x = (t: number) => 1 - Math.exp(-k * t) * (Math.cos(wd * t) + (k / wd) * Math.sin(wd * t));
  const T = Math.log(200) / k;
  const pts = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x((T * i) / n).toFixed(4)));
  return { easing: `linear(${pts.join(", ")})`, ms: Math.round(T * 1000) };
}
