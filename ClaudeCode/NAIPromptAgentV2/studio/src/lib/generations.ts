import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db, getSetting } from "./db";
import { expiredIds } from "./retention";
import { DATA_DIR, GALLERY_DIR } from "./env";
import { safeGalleryName } from "./gallery";
import type { NaiParams } from "./nai-body";
import type { PromptState } from "./prompt";

export type Generation = { id: number; file: string; seed: number; state: PromptState; params: NaiParams; png: Buffer };

/** A saved generation with its PNG bytes, or null when the row or file is gone. */
export async function readGeneration(id: number): Promise<Generation | null> {
  const row = db.prepare("SELECT id, file, seed, state, params FROM generations WHERE id = ?").get(id) as
    { id: number; file: string; seed: number; state: string; params: string } | undefined;
  const name = row && safeGalleryName(row.file);
  if (!row || !name) return null;
  const png = await fs.readFile(path.join(GALLERY_DIR, name)).catch(() => null);
  return png && { id: row.id, file: name, seed: row.seed, state: JSON.parse(row.state), params: JSON.parse(row.params), png };
}

/** Save a new generation row; returns its id. */
/** cost: Anlas spent (balance before − after); null when the balance couldn't be read. */
export function insertGeneration(g: { model: string; seed: number; file: string; state: PromptState; params: NaiParams; gridId: string | null; cost?: number | null }): number {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO generations (created_at, model, seed, file, state, params, grid_id, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), g.model, g.seed, g.file, JSON.stringify(g.state), JSON.stringify(g.params), g.gridId, g.cost ?? null);
  return Number(lastInsertRowid);
}

/** Permanently remove generations (rows + PNG files). Returns how many were deleted. */
export async function deleteGenerations(ids: number[] | "all"): Promise<number> {
  const rows = (ids === "all"
    ? db.prepare("SELECT id, file FROM generations").all()
    : db.prepare(`SELECT id, file FROM generations WHERE id IN (${ids.map(() => "?").join(",") || "NULL"})`).all(...ids)) as { id: number; file: string }[];
  for (const r of rows) {
    const name = safeGalleryName(r.file);
    if (!name) continue;
    await fs.unlink(path.join(GALLERY_DIR, name)).catch(() => {});
    // and its cached thumbnails (api/gallery ?w=)
    for (const w of [256, 512]) await fs.unlink(path.join(DATA_DIR, "thumbs", `${name.replace(/\.png$/, "")}-${w}.webp`)).catch(() => {});
  }
  const del = db.prepare("DELETE FROM generations WHERE id = ?");
  db.transaction(() => rows.forEach((r) => del.run(r.id)))();
  return rows.length;
}

export const autoDeleteDays = (): number | null => Number(getSetting("auto_delete_days")) || null;

let lastSweep = 0;
/** Apply the auto-delete window (Settings). Cheap enough to call on every history listing; at most once a minute. */
export async function sweepExpired(now = Date.now()): Promise<number> {
  if (now - lastSweep < 60_000) return 0;
  lastSweep = now;
  const ids = expiredIds(db.prepare("SELECT id, created_at FROM generations").all() as { id: number; created_at: number }[], autoDeleteDays(), now);
  return ids.length ? deleteGenerations(ids) : 0;
}

// Hourly sweep while the server runs (guarded so dev hot-reload doesn't stack timers).
const g = globalThis as unknown as { __studioSweep?: NodeJS.Timeout };
g.__studioSweep ??= setInterval(() => { sweepExpired().catch(() => {}); }, 3_600_000);
