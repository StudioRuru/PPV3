/** Gesture axis once past a 10px slop; only a clearly horizontal drag locks "x". */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < 10) return null;
  return Math.abs(dx) > 1.5 * Math.abs(dy) ? "x" : "y";
}

/** Next version index for a swipe; past the last version regenerates. */
export function swipeTarget(o: { index: number; count: number; dir: 1 | -1; busy: boolean }): number | "regenerate" | null {
  if (o.busy) return null;
  const n = o.index + o.dir;
  if (n >= o.count) return "regenerate";
  return n < 0 ? null : n;
}

export const atBottom = (viewport: number, scrollY: number, scrollHeight: number, slack = 120) => viewport + scrollY >= scrollHeight - slack;

export const loreCount = (ids: (number | null | undefined)[]) => new Set(ids.filter((i) => i != null)).size;
