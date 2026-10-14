/** Elements a tab swipe must never start on (scrolling, dragging, typing, canvas/tagger work). */
export const NO_SWIPE = "[data-noswipe],input,textarea,select,[role=application],[role=slider],.sheet[data-open]";

/** A quick, mostly-horizontal flick: next (leftward) / prev (rightward); anything else is a scroll or a drag. */
export function swipeDirection({ dx, dy, ms }: { dx: number; dy: number; ms: number }): "next" | "prev" | null {
  if (Math.abs(dx) < 56 || Math.abs(dx) < 2 * Math.abs(dy) || ms > 450) return null;
  return dx < 0 ? "next" : "prev";
}
