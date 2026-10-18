import type { Cell, CellStatus, SpriteKey, Take } from "@/lib/sprites/core";

export type TakeView = Take & { file?: string; poster?: string };
export type CellView = Cell & { status: CellStatus; takes: TakeView[] };
export type GridRow = { from: string; cols: { to: string; cell: CellView | null; reverse: boolean }[] };

/** Chat matrix: rows and columns are the keys in `sort` order; the diagonal is the idle; pairs below it are reverse (played from the mirror clip). */
export function gridRows(keys: SpriteKey[], cells: CellView[], outfit: string): GridRow[] {
  const ks = keys.filter((k) => k.surface === "chat").sort((a, b) => a.sort - b.sort);
  const by = new Map(cells.filter((c) => c.surface === "chat" && c.outfit === outfit).map((c) => [`${c.from}\0${c.to}`, c]));
  return ks.map((f, i) => ({ from: f.key, cols: ks.map((t, j) => ({ to: t.key, cell: by.get(`${f.key}\0${t.key}`) ?? null, reverse: i > j })) }));
}
