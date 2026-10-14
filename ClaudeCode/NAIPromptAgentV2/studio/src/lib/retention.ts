/** Auto-delete window in days; null/0 = never. */
export type Retention = 1 | 2 | 3 | null;

/** Ids of generations older than `days` (by their own created_at timestamp). */
export function expiredIds(rows: { id: number; created_at: number }[], days: number | null, now = Date.now()): number[] {
  if (!days) return [];
  const cutoff = now - days * 86_400_000;
  return rows.filter((r) => r.created_at < cutoff).map((r) => r.id);
}
