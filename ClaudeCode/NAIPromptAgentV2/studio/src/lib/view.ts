/** Viewer zoom state: scale plus translate (px), relative to the image centred in its box. */
export type View = { s: number; x: number; y: number };
type Pt = { x: number; y: number };

/**
 * Zoom by `ratio` keeping the image point that was under p0 (finger midpoint at gesture start, relative
 * to the box centre) under p1 (where the midpoint is now) — so pinch zooms where you pinch and pans as you move.
 */
export function zoomAt(from: View, p0: Pt, p1: Pt, ratio: number): View {
  const s = Math.min(5, Math.max(1, from.s * ratio));
  const k = s / from.s;
  return { s, x: p1.x - k * (p0.x - from.x), y: p1.y - k * (p0.y - from.y) };
}

/** Keep the zoomed image covering the box: no panning past its edges. */
export function clampView(v: View, img: { w: number; h: number }, box: { w: number; h: number }): View {
  const mx = Math.max(0, (v.s * img.w - box.w) / 2), my = Math.max(0, (v.s * img.h - box.h) / 2);
  const c = (n: number, m: number) => Math.min(m, Math.max(-m, n)) + 0; // +0: no -0
  return { s: v.s, x: c(v.x, mx), y: c(v.y, my) };
}
