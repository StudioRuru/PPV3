/** The weight slider shows the offset from normal: centre 0 = unweighted (NovelAI weight 1). */
const r2 = (v: number) => Math.round(v * 100) / 100;

export const toOffset = (w: number | undefined): number => r2((w ?? 1) - 1);

/** Offset → stored weight; 0 → undefined (unweighted). */
export function fromOffset(o: number): number | undefined {
  const w = r2(1 + o);
  return w === 1 ? undefined : w;
}

export function offsetLabel(w: number | undefined): string {
  const o = toOffset(w);
  return o === 0 ? "0" : `${o > 0 ? "+" : "−"}${Math.abs(o).toFixed(2)}`;
}
