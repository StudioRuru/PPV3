export type ExportPick = { today?: boolean; last?: number; ids?: number[] };
type Row = { id: number; created_at: number };

/** ponytail: 200 images per zip keeps it in memory (upscales are ~15 MB each); stream if exports grow. */
export const EXPORT_CAP = 200;

/** Which generations go in the zip, newest first. */
export function pickRows<R extends Row>(rows: R[], pick: ExportPick, now = Date.now()): R[] {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  const chosen = pick.ids ? sorted.filter((r) => pick.ids!.includes(r.id))
    : pick.today ? sorted.filter((r) => r.created_at >= midnight.getTime())
    : sorted.slice(0, Math.max(0, Math.floor(pick.last ?? 0)));
  return chosen.slice(0, EXPORT_CAP);
}

export function zipName(rows: Row[]): string {
  const d = new Date(rows[0]?.created_at ?? Date.now());
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `nai-studio-${ymd}-${rows.length}-images.zip`;
}
