import type { NaiParams } from "./nai-body";
import type { PromptState } from "./prompt";

export type GridLine = { id: string; text: string; where: string };

/** Evenly spaced weights from min to max; 3–6 cells (spec §4.3). */
export function gridWeights(min: number, max: number, steps: number): number[] {
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  const n = Math.min(6, Math.max(3, Math.round(steps)));
  return Array.from({ length: n }, (_, i) => Number((lo + ((hi - lo) * i) / (n - 1)).toFixed(2)));
}

export function gridLines(s: PromptState): GridLine[] {
  const pick = (where: string) => (l: { id: string; text: string }) => ({ id: l.id, text: l.text.trim(), where });
  return [...s.base.map(pick("Base")), ...s.chars.flatMap((c, i) => c.lines.map(pick(`Character ${i + 1}`)))].filter((l) => l.text);
}

/** Same state with one line (base or any character) at weight w; 1 means unweighted. */
export function setLineWeight(s: PromptState, id: string, w: number): PromptState {
  const weight = w === 1 ? undefined : w;
  const edit = <L extends { id: string }>(lines: L[]) => lines.map((l) => (l.id === id ? { ...l, weight } : l));
  if (s.base.some((l) => l.id === id)) return { ...s, base: edit(s.base) };
  const ci = s.chars.findIndex((c) => c.lines.some((l) => l.id === id));
  if (ci < 0) return s;
  return { ...s, chars: s.chars.map((c, i) => (i === ci ? { ...c, lines: edit(c.lines) } : c)) };
}

/** Opus: one image at ≤1 Mpx and ≤28 steps spends no Anlas. */
export const isFree = (p: NaiParams) => p.width * p.height <= 1_048_576 && p.steps <= 28;
