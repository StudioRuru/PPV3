/** Auto-delete window in days; null/0 = never. */
export type Retention = 1 | 2 | 3 | null;

/** Stored setting → days. Only 1, 2 or 3 are valid; anything else (0, garbage, a bad manual edit) means never. */
export function parseRetention(v: string | null): Retention {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/** Ids of generations older than `days` (by their own created_at timestamp). */
export function expiredIds(rows: { id: number; created_at: number }[], days: number | null, now = Date.now()): number[] {
  if (!days) return [];
  const cutoff = now - days * 86_400_000;
  return rows.filter((r) => r.created_at < cutoff).map((r) => r.id);
}
