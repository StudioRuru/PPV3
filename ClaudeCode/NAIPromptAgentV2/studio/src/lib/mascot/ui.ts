// Pure helpers for the floating mascot.
import { EXPRESSIONS, OUTFITS, type Expression, type Outfit } from "./core";
import { POSES, poseKey, type Pose } from "./poses";
import { SLIDERS } from "./slime";
import { parseVialBlock, type Vial } from "./vial";
export type Corner = "br" | "bl" | "tr" | "tl";

/** Tags present in next but not prev (added) and vice versa (removed), first-seen order, no dupes. */
export function diffTags(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const a = new Set(prev), b = new Set(next);
  return { added: [...b].filter((t) => !a.has(t)), removed: [...a].filter((t) => !b.has(t)) };
}

/** Corner of a w×h viewport closest to point (x, y); ties go bottom/right. */
export const nearestCorner = (x: number, y: number, w: number, h: number): Corner =>
  `${y >= h / 2 ? "b" : "t"}${x >= w / 2 ? "r" : "l"}` as Corner;

/** Mascot bottom offset from the tallest clearance (px from the viewport bottom to a visible [data-composer]'s top; 0 = hidden); fallback clears the Generate bar. */
export function composerBottom(heights: number[]): string {
  const h = Math.max(0, ...heights);
  return h ? `calc(${Math.ceil(h)}px + 0.5rem)` : "calc(env(safe-area-inset-bottom) + 5rem)";
}

// Chattiness slider: one stop per step, plus a last stop = only when tapped (null cooldown).
export const COOLDOWN_STEPS = [30000, 60000, 120000, 180000, 300000, 450000, 600000];
export const sliderToCooldown = (i: number): number | null => COOLDOWN_STEPS[i] ?? null;
export function cooldownToSlider(ms: number | null): number {
  if (ms === null || !Number.isFinite(ms)) return COOLDOWN_STEPS.length;
  return COOLDOWN_STEPS.reduce((best, s, i) => (Math.abs(s - ms) < Math.abs(COOLDOWN_STEPS[best] - ms) ? i : best), 0);
}
export const cooldownLabel = (ms: number | null): string =>
  ms === null || !Number.isFinite(ms) ? "Only when tapped" : ms < 60000 ? `${ms / 1000} s` : `${+(ms / 60000).toFixed(1)} min`;

/** Studio cells of one outfit with no saved sprite yet: the full sprite first, then bust expressions in order. */
export function missingCells(sprites: Record<string, number>, outfit: Outfit): { kind: "bust" | "full"; expr: Expression }[] {
  const cells = [{ kind: "full" as const, expr: "smug" as Expression }, ...EXPRESSIONS.map((expr) => ({ kind: "bust" as const, expr }))];
  return cells.filter((c) => !(`${outfit}/${c.kind === "full" ? "full" : c.expr}` in sprites));
}

export type PoseCell = { pose: Pose; outfit: Outfit; expr: Expression };
/** Every pose cell in order (pose, outfit, expression); back = one cell per outfit (expr smug, ignored). */
export function poseCells(f: { pose?: Pose; outfit?: Outfit }): PoseCell[] {
  return (f.pose ? [f.pose] : [...POSES]).flatMap((pose) => (f.outfit ? [f.outfit] : OUTFITS).flatMap((outfit) =>
    (pose === "back" ? ["smug" as Expression] : [...EXPRESSIONS]).map((expr) => ({ pose, outfit, expr }))));
}
/** Pose sprites not saved yet, for a pose (all outfits), an outfit (all poses), or both. */
export const missingPoseCells = (sprites: Record<string, number>, f: { pose?: Pose; outfit?: Outfit }): PoseCell[] =>
  poseCells(f).filter((c) => !(poseKey(c.pose, c.outfit, c.expr) in sprites));

/** Request sequencing: `start()` numbers a request; `done(n)` says whether its response is still the latest to apply. */
export function requestSeq() {
  let last = 0, out = 0;
  return {
    busy: () => out > 0,
    start: () => { out++; return ++last; },
    done: (n: number) => { out--; return n === last; },
  };
}

// Apothecary.
const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;
/** A vial's slider deltas as chip labels ("brat +2", "heat cap −1"), in slider order; zeros skipped. */
export function deltaChips(sliders: Vial["sliders"]): string[] {
  return SLIDERS.flatMap((k) => {
    const d = sliders?.[k];
    return [d?.value ? `${k} ${signed(d.value)}` : "", d?.cap ? `${k} cap ${signed(d.cap)}` : ""].filter(Boolean);
  });
}

export type Bottle = Vial & { id: number };
/** Bottles stacked by name (case-insensitive): oldest bottle's look, ids oldest first, sorted by name. */
export function groupBottles(bottles: Bottle[]): (Vial & { ids: number[]; count: number })[] {
  const by = new Map<string, Vial & { ids: number[]; count: number }>();
  for (const b of [...bottles].sort((x, y) => x.id - y.id)) {
    const key = b.name.trim().toLowerCase(), g = by.get(key);
    if (g) { g.ids.push(b.id); g.count++; } else { const { id, ...v } = b; by.set(key, { ...v, ids: [id], count: 1 }); }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Jar dose badge colour: grey, purple when poisoned, deep purple when severely poisoned. */
export const poisonTone = (poison: 0 | 1 | 2) => ["#4b5563", "#9333ea", "#581c87"][poison];

/** Reply text without its ```vial blocks (an unclosed one while streaming is hidden too). */
export const stripVialBlock = (text: string) =>
  text.replace(/```vial[ \t]*(\r?\n[\s\S]*?(```|$)|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();

/** What a reply's vial block amounts to once it has finished: a vial, a fumble (cut off / invalid), or nothing (no block, or still streaming). */
export function vialOutcome(text: string, done: boolean): { kind: "vial"; vial: Vial } | { kind: "fumbled" } | null {
  if (!done || !/```vial/i.test(text)) return null;
  const r = parseVialBlock(text);
  return r && !("error" in r) ? { kind: "vial", vial: r } : { kind: "fumbled" };
}

/** Stable "already bottled" marker for a vial offered in a thread: thread id + a djb2 hash of the vial JSON. */
export function bottledKey(threadId: number, vial: Vial): string {
  let h = 5381;
  for (const ch of JSON.stringify(vial)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${threadId}:${h.toString(36)}`;
}
