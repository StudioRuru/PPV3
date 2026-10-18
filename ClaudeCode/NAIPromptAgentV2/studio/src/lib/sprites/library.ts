import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { dropItem } from "./service";
import { type SpriteKey, type Surface, edges, listKeys, listOutfits, removeKey } from "./store";

type Db = Database.Database;
export type LibClip = { surface: Surface; outfit: string; from: string; to: string; frames: number; fps: number; w: number; h: number; v: number; reverseOf?: string };
export type Library = { outfits: string[]; keys: SpriteKey[]; edges: [string, string][]; clips: LibClip[] };
type Row = { surface: Surface; outfit: string; from_key: string; to_key: string; cut: string; reverse: number };

const metaOf = (lib: string, r: Row) => {
  try { return JSON.parse(fs.readFileSync(path.join(lib, r.surface, r.outfit, `${r.from_key}~${r.to_key}`, "meta.json"), "utf8")) as Pick<LibClip, "frames" | "fps" | "w" | "h" | "v">; } catch { return null; }
};

/** Cut clips only; a chat pair that plays its mirror backwards is listed once the mirror is cut. */
export function library(db: Db, lib: string): Library {
  const rows = db.prepare("SELECT surface, outfit, from_key, to_key, cut, reverse FROM sprite_cells WHERE to_key != '' AND from_key != '@base'").all() as Row[];
  const done = new Map(rows.filter((r) => r.cut === "done").map((r) => [`${r.surface}/${r.outfit}/${r.from_key}~${r.to_key}`, r]));
  const clips: LibClip[] = [];
  for (const r of rows) {
    const own = done.get(`${r.surface}/${r.outfit}/${r.from_key}~${r.to_key}`);
    const mirror = !own && r.reverse && r.surface === "chat" ? done.get(`chat/${r.outfit}/${r.to_key}~${r.from_key}`) : undefined;
    const src = own ?? mirror;
    const m = src && metaOf(lib, src);
    if (m) clips.push({ surface: r.surface, outfit: r.outfit, from: r.from_key, to: r.to_key, ...m, ...(mirror && { reverseOf: `${r.to_key}~${r.from_key}` }) });
  }
  return { outfits: listOutfits(db).map((o) => o.key), keys: [...listKeys(db, "chat"), ...listKeys(db, "stage")], edges: edges(db), clips };
}

/** lib/<parts…> or null if any part could leave the library. */
export function safeLibPath(lib: string, parts: string[]): string | null {
  if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || /[/\\\0]/.test(p))) return null;
  return path.join(lib, ...parts);
}

/** Removes an inventory key with its edges, cells, takes, cut frames and generated items; library-adopted items stay. */
export function removeKeyData(db: Db, surface: Surface, key: string, o: { dir: string; lib: string }): void {
  const cells = db.prepare("SELECT id, outfit, from_key, to_key FROM sprite_cells WHERE surface = ? AND (from_key = ? OR to_key = ?)").all(surface, key, key) as
    { id: number; outfit: string; from_key: string; to_key: string }[];
  for (const c of cells) {
    const items = db.prepare("SELECT item_id FROM sprite_takes WHERE cell_id = ? AND job_id IS NOT NULL AND item_id IS NOT NULL").all(c.id) as { item_id: number }[];
    for (const { item_id } of items) dropItem(db, item_id, o.dir);
    db.prepare("DELETE FROM sprite_takes WHERE cell_id = ?").run(c.id);
    db.prepare("DELETE FROM sprite_cells WHERE id = ?").run(c.id);
    const dir = c.to_key ? safeLibPath(o.lib, [surface, c.outfit, `${c.from_key}~${c.to_key}`]) : null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (surface === "stage") db.prepare("DELETE FROM sprite_edges WHERE a = ? OR b = ?").run(key, key);
  removeKey(db, surface, key);
}
