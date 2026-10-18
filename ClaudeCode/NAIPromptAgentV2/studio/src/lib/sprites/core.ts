// Pure, client-safe: no node / better-sqlite3 imports.
export type Surface = "chat" | "stage";
export type Tier = "tame" | "teasing" | "lewd";
export type Boldness = Tier;
export type SpriteKey = { surface: Surface; key: string; label: string; tier: Tier; tags: string[]; prompt: string; sort: number };
export type Cell = { id: number; surface: Surface; outfit: string; from: string; to: string; approvedTake: number | null; rejected: boolean; reverse: boolean; cut: "none" | "cutting" | "done" | "error" };
export type LibClip = { surface: Surface; outfit: string; from: string; to: string; frames: number; fps: number; w: number; h: number; v: number; reverseOf?: string };
export type Library = { outfits: string[]; keys: SpriteKey[]; edges: [string, string][]; clips: LibClip[] };
export type Take = { id: number; cellId: number; jobId: number | null; itemId: number | null; seed: number; recipe: unknown };
export type CellStatus = "empty" | "queued" | "generating" | "review" | "approved" | "rejected";
export type JobStatus = "queued" | "running" | "done" | "error";

const RANK: Record<Tier, number> = { tame: 0, teasing: 1, lewd: 2 };

/** Keys the boldness allows; lewd-tagged keys additionally need the lewd outfit and lewd boldness. */
export function allowedKeys(keys: SpriteKey[], boldness: Boldness, outfit: string): SpriteKey[] {
  return keys.filter((k) => RANK[k.tier] <= RANK[boldness] && (!k.tags.includes("lewd") || (outfit === "lewd" && boldness === "lewd")));
}

export function cellStatus(c: Cell, ts: Take[], jobStatus: (id: number) => JobStatus | null): CellStatus {
  if (c.approvedTake != null) return "approved";
  const js = ts.map((t) => (t.jobId == null ? null : jobStatus(t.jobId)));
  const running = js.includes("running"), queued = js.includes("queued");
  if (c.rejected && !running && !queued) return "rejected";
  if (running) return "generating";
  if (queued) return "queued";
  if (ts.some((t) => t.itemId != null)) return "review";
  return "empty";
}
