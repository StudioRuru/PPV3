// Pure helpers for the slime shelf.
export type JarInfo = { id: number; name: string; color: string; origin: string; selfName: string; active: boolean };
export type Slot = { kind: "empty" } | { kind: "jar"; jar: JarInfo };

export const PALETTE = ["#f0abfc", "#f472b6", "#fb7185", "#f97316", "#facc15", "#a3e635", "#34d399", "#22d3ee", "#60a5fa", "#a78bfa"];
export const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** Shelf rows: the empty slot first when she's Empty, then jars by id (oldest first), `perRow` per row. */
export function shelfRows(jars: JarInfo[], empty: boolean, perRow = 3): Slot[][] {
  const slots: Slot[] = [...(empty ? [{ kind: "empty" as const }] : []), ...[...jars].sort((a, b) => a.id - b.id).map((jar) => ({ kind: "jar" as const, jar }))];
  return Array.from({ length: Math.ceil(slots.length / perRow) }, (_, i) => slots.slice(i * perRow, i * perRow + perRow));
}

export const ratioLabel = (ratio: number, a = "A", b = "B") => `${ratio}% ${a} / ${100 - ratio}% ${b}`;

export type MixForm = { a: number | null; b: number | "blank" | null; ratio: number; name: string; color: string };
/** First problem with the mix form (mirrors the API's checks), or null when it can be sent. */
export function mixError(f: MixForm): string | null {
  if (f.a === null) return "Pick the first jar.";
  if (f.b === null) return "Pick a second jar or Blank.";
  if (f.b === f.a) return "Pick two different jars.";
  if (!Number.isInteger(f.ratio) || f.ratio < 10 || f.ratio > 90) return "Ratio must be 10–90%.";
  const n = f.name.trim();
  if (!n || n.length > 40) return "Give the jar a name (up to 40 characters).";
  if (!isHex(f.color)) return "Pick a colour.";
  return null;
}
