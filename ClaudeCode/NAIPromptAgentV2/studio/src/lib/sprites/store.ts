import type Database from "better-sqlite3";
import { migrate } from "@/lib/comfy/store";
import type { Cell, SpriteKey, Surface, Take, Tier } from "./core";

export * from "./core";
type Db = Database.Database;

/** Maps stored rows, skipping (and logging) any whose JSON is corrupt so one bad row can't break a list. */
function parsed<R extends { id: number }, T>(rows: R[], map: (r: R) => T, what: string): T[] {
  return rows.flatMap((r) => {
    try { return [map(r)]; } catch { console.warn(`sprites: skipping ${what} ${r.id} with unreadable JSON`); return []; }
  });
}

const chatP = (d: string) => `same character, same outfit, same framing, plain white background; ${d}`;
const stageP = (d: string) => `same character, same outfit, full body, plain white background; ${d}`;
type Seed = [key: string, label: string, tier: Tier, tags: string[], desc: string];
const CHAT: Seed[] = [
  ["neutral", "Neutral", "tame", [], "calm neutral expression, relaxed mouth"],
  ["happy", "Happy", "tame", [], "bright happy smile"],
  ["laughing", "Laughing", "tame", [], "laughing with open mouth, eyes squeezed shut"],
  ["pouty", "Pouty", "tame", [], "pouting with puffed cheeks"],
  ["annoyed", "Annoyed", "tame", [], "annoyed, furrowed brows, flat mouth"],
  ["sad", "Sad", "tame", [], "sad, downturned mouth, teary eyes"],
  ["surprised", "Surprised", "tame", [], "surprised, wide eyes, open mouth"],
  ["sleepy", "Sleepy", "tame", [], "sleepy, half-closed eyes, small yawn"],
  ["smug", "Smug", "teasing", ["adult"], "smug smirk, half-lidded eyes, raised brow"],
  ["blush", "Blush", "teasing", ["adult"], "deep blush, bashful averted eyes, shy smile"],
  ["humiliated", "Humiliated", "lewd", ["adult"], "humiliated, flushed face, trembling lip, glistening eyes"],
  ["horny", "Horny", "lewd", ["adult"], "aroused, heavy blush, half-lidded eyes, parted lips"],
  ["yandere", "Yandere", "lewd", ["adult"], "yandere, unsettling smile, wide dark empty eyes, flushed"],
];
const STAGE: Seed[] = [
  ["stand", "Stand", "tame", [], "standing upright, relaxed, facing the viewer"],
  ["look_left", "Look left", "tame", [], "standing, head turned to look left"],
  ["look_right", "Look right", "tame", [], "standing, head turned to look right"],
  ["look_up", "Look up", "tame", [], "standing, chin raised, looking up"],
  ["face_viewer", "Face viewer", "tame", [], "standing, body turned fully toward the viewer"],
  ["face_away", "Face away", "tame", [], "standing with her back to the viewer"],
  ["check_nails", "Check nails", "tame", [], "standing, one hand raised, inspecting her nails"],
  ["sit", "Sit", "tame", [], "sitting down, hands in lap"],
  ["squat", "Squat", "tame", [], "squatting, arms resting on knees"],
  ["stretch_legs", "Stretch legs", "tame", [], "sitting with legs stretched out in front"],
  ["lie_down", "Lie down", "tame", [], "lying down on her back"],
  ["hip_pop", "Hip pop", "tame", ["feminine"], "standing, one hip popped out, hand on hip"],
  ["hair_twirl", "Hair twirl", "tame", ["feminine"], "standing, twirling a lock of hair around a finger"],
  ["kneel", "Kneel", "tame", ["feminine"], "kneeling, sitting back on her heels"],
];
const EDGES = "stand-look_left stand-look_right stand-look_up stand-face_viewer stand-face_away stand-check_nails stand-hip_pop stand-hair_twirl stand-sit stand-squat sit-check_nails sit-stretch_legs sit-lie_down sit-kneel squat-kneel lie_down-stretch_legs face_viewer-hip_pop face_viewer-hair_twirl look_left-look_right kneel-lie_down".split(" ");

export function migrateSprites(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS sprite_outfits (key TEXT PRIMARY KEY, label TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sprite_keys (surface TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, tier TEXT NOT NULL, tags TEXT NOT NULL, prompt TEXT NOT NULL, sort INTEGER NOT NULL, PRIMARY KEY (surface, key));
CREATE TABLE IF NOT EXISTS sprite_edges (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b), CHECK (a < b));
CREATE TABLE IF NOT EXISTS sprite_cells (id INTEGER PRIMARY KEY AUTOINCREMENT, surface TEXT NOT NULL, outfit TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, approved_take INTEGER, rejected INTEGER NOT NULL DEFAULT 0, reverse INTEGER NOT NULL DEFAULT 0, cut TEXT NOT NULL DEFAULT 'none', UNIQUE (surface, outfit, from_key, to_key));
CREATE TABLE IF NOT EXISTS sprite_takes (id INTEGER PRIMARY KEY AUTOINCREMENT, cell_id INTEGER NOT NULL, job_id INTEGER, item_id INTEGER, seed INTEGER NOT NULL, recipe TEXT NOT NULL)`);
  const o = db.prepare("INSERT OR IGNORE INTO sprite_outfits (key, label, sort) VALUES (?,?,?)");
  [["day", "Day"], ["night", "Night"], ["lewd", "Lewd"]].forEach(([k, l], i) => o.run(k, l, i));
  const k = db.prepare("INSERT OR IGNORE INTO sprite_keys (surface, key, label, tier, tags, prompt, sort) VALUES (?,?,?,?,?,?,?)");
  CHAT.forEach(([key, label, tier, tags, d], i) => k.run("chat", key, label, tier, JSON.stringify(tags), chatP(d), i));
  STAGE.forEach(([key, label, tier, tags, d], i) => k.run("stage", key, label, tier, JSON.stringify(tags), stageP(d), i));
  const e = db.prepare("INSERT OR IGNORE INTO sprite_edges (a, b) VALUES (?,?)");
  EDGES.forEach((p) => { const [a, b] = p.split("-").sort(); e.run(a, b); });
}

let migrated: Db | null = null;
/** The app db with comfy + sprite tables, migrated once. Lazy require keeps server-only db.ts out of unit tests. */
export function spritesDb(): Db {
  if (!migrated) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { db } = require("@/lib/db") as { db: Db };
    migrate(db);
    migrateSprites(db);
    migrated = db;
  }
  return migrated;
}

// ---- Inventory
type KeySql = { id: number; surface: Surface; key: string; label: string; tier: Tier; tags: string; prompt: string; sort: number };
export function listKeys(db: Db, surface: Surface): SpriteKey[] {
  const rows = (db.prepare("SELECT rowid AS id, * FROM sprite_keys WHERE surface = ? ORDER BY sort, rowid").all(surface) as KeySql[]);
  return parsed(rows, (r) => ({ surface: r.surface, key: r.key, label: r.label, tier: r.tier, tags: JSON.parse(r.tags) as string[], prompt: r.prompt, sort: r.sort }), "key");
}
export function upsertKey(db: Db, k: SpriteKey): void {
  db.prepare("INSERT OR REPLACE INTO sprite_keys (surface, key, label, tier, tags, prompt, sort) VALUES (?,?,?,?,?,?,?)")
    .run(k.surface, k.key, k.label, k.tier, JSON.stringify(k.tags), k.prompt, k.sort);
}
export function removeKey(db: Db, surface: Surface, key: string): void {
  db.prepare("DELETE FROM sprite_keys WHERE surface = ? AND key = ?").run(surface, key);
}
export function listOutfits(db: Db): { key: string; label: string }[] {
  return db.prepare("SELECT key, label FROM sprite_outfits ORDER BY sort, rowid").all() as { key: string; label: string }[];
}
export function addOutfit(db: Db, key: string, label: string): void {
  const n = (db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM sprite_outfits").get() as { n: number }).n;
  db.prepare("INSERT OR IGNORE INTO sprite_outfits (key, label, sort) VALUES (?,?,?)").run(key, label, n);
}
export function edges(db: Db): [string, string][] {
  return (db.prepare("SELECT a, b FROM sprite_edges ORDER BY a, b").all() as { a: string; b: string }[]).map((r) => [r.a, r.b]);
}
export function setEdge(db: Db, a: string, b: string, on: boolean): void {
  if (a === b) return;
  const [x, y] = [a, b].sort();
  if (on) db.prepare("INSERT OR IGNORE INTO sprite_edges (a, b) VALUES (?,?)").run(x, y);
  else db.prepare("DELETE FROM sprite_edges WHERE a = ? AND b = ?").run(x, y);
}

// ---- Cells
type CellSql = { id: number; surface: Surface; outfit: string; from_key: string; to_key: string; approved_take: number | null; rejected: number; reverse: number; cut: Cell["cut"] };
const toCell = (r: CellSql): Cell => ({ id: r.id, surface: r.surface, outfit: r.outfit, from: r.from_key, to: r.to_key, approvedTake: r.approved_take, rejected: !!r.rejected, reverse: !!r.reverse, cut: r.cut });
const SEL_CELL = "SELECT * FROM sprite_cells WHERE surface = ? AND outfit = ? AND from_key = ? AND to_key = ?";
export function cell(db: Db, surface: Surface, outfit: string, from: string, to: string): Cell {
  const r = db.prepare(SEL_CELL).get(surface, outfit, from, to) as CellSql | undefined;
  if (r) return toCell(r);
  let reverse = 0;
  if (surface === "chat" && from !== to && to !== "" && from !== "@base") {
    const sort = (key: string) => (db.prepare("SELECT sort FROM sprite_keys WHERE surface = 'chat' AND key = ?").get(key) as { sort: number } | undefined)?.sort;
    const [sf, st] = [sort(from), sort(to)];
    reverse = sf != null && st != null && sf > st ? 1 : 0;
  }
  db.prepare("INSERT INTO sprite_cells (surface, outfit, from_key, to_key, reverse) VALUES (?,?,?,?,?)").run(surface, outfit, from, to, reverse);
  return toCell(db.prepare(SEL_CELL).get(surface, outfit, from, to) as CellSql);
}

// ---- Takes
type TakeSql = { id: number; cell_id: number; job_id: number | null; item_id: number | null; seed: number; recipe: string };
export function addTake(db: Db, cellId: number, jobId: number | null, seed: number, recipe: unknown): number {
  return Number(db.prepare("INSERT INTO sprite_takes (cell_id, job_id, seed, recipe) VALUES (?,?,?,?)").run(cellId, jobId, seed, JSON.stringify(recipe)).lastInsertRowid);
}
export function takes(db: Db, cellId: number): Take[] {
  return parsed(db.prepare("SELECT * FROM sprite_takes WHERE cell_id = ? ORDER BY id").all(cellId) as TakeSql[],
    (r) => ({ id: r.id, cellId: r.cell_id, jobId: r.job_id, itemId: r.item_id, seed: r.seed, recipe: JSON.parse(r.recipe) as unknown }), "take");
}
export function linkTakeItem(db: Db, takeId: number, itemId: number): void {
  db.prepare("UPDATE sprite_takes SET item_id = ? WHERE id = ?").run(itemId, takeId);
}

// ---- Decisions
export function approve(db: Db, cellId: number, takeId: number): { dropItems: number[] } {
  return db.transaction(() => {
    const c = db.prepare("SELECT * FROM sprite_cells WHERE id = ?").get(cellId) as CellSql;
    const dropItems = (db.prepare("SELECT item_id FROM sprite_takes WHERE cell_id = ? AND id != ? AND item_id IS NOT NULL ORDER BY id").all(cellId, takeId) as { item_id: number }[]).map((r) => r.item_id);
    db.prepare("UPDATE sprite_takes SET item_id = NULL WHERE cell_id = ? AND id != ?").run(cellId, takeId);
    db.prepare("UPDATE sprite_cells SET approved_take = ?, rejected = 0, cut = 'none' WHERE id = ?").run(takeId, cellId);
    if (c.to_key === "") staleDependents(db, c.surface, c.outfit, c.from_key);
    return { dropItems };
  })();
}
export function reject(db: Db, cellId: number): void {
  db.prepare("UPDATE sprite_cells SET rejected = 1 WHERE id = ?").run(cellId);
}
/** Un-approves clips touching `key` (never endpoints); `@base` un-approves everything but the base itself. */
export function staleDependents(db: Db, surface: Surface, outfit: string, key: string): void {
  const reset = "UPDATE sprite_cells SET approved_take = NULL, cut = 'none' WHERE surface = ? AND outfit = ?";
  if (key === "@base") db.prepare(`${reset} AND from_key != '@base'`).run(surface, outfit);
  else db.prepare(`${reset} AND to_key != '' AND (from_key = ? OR to_key = ?)`).run(surface, outfit, key, key);
}
