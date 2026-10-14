import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { GALLERY_DIR } from "./env";
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
export function insertGeneration(g: { model: string; seed: number; file: string; state: PromptState; params: NaiParams; gridId: string | null }): number {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO generations (created_at, model, seed, file, state, params, grid_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), g.model, g.seed, g.file, JSON.stringify(g.state), JSON.stringify(g.params), g.gridId);
  return Number(lastInsertRowid);
}
