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
