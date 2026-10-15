// Pure helpers for the floating mascot.
export type Corner = "br" | "bl" | "tr" | "tl";

/** Tags present in next but not prev (added) and vice versa (removed), first-seen order, no dupes. */
export function diffTags(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const a = new Set(prev), b = new Set(next);
  return { added: [...b].filter((t) => !a.has(t)), removed: [...a].filter((t) => !b.has(t)) };
}

/** Corner of a w×h viewport closest to point (x, y); ties go bottom/right. */
export const nearestCorner = (x: number, y: number, w: number, h: number): Corner =>
  `${y >= h / 2 ? "b" : "t"}${x >= w / 2 ? "r" : "l"}` as Corner;

const TAB_BAR = "env(safe-area-inset-bottom) + 3.5rem";
/** Mascot bottom offset: above the tab bar and the tallest visible [data-composer] (0 = hidden); fallback clears the Generate bar. */
export function composerBottom(heights: number[]): string {
  const h = Math.max(0, ...heights);
  return h ? `calc(${TAB_BAR} + ${Math.ceil(h)}px + 0.5rem)` : "calc(env(safe-area-inset-bottom) + 8.5rem)";
}
