import type Database from "better-sqlite3";

export type Card = "main" | "boost";
export type VmRow = { card: Card; vmId: string; env: string; flavor: string; host: string; usdHr: number; status: string };
export type Run = { id: number; card: Card; vmId: string; usdHr: number; startedAt: number; stoppedAt: number | null; stopReason: string | null };
export type JobKind = "photo" | "video" | "pose" | "edit" | "sprite";
export type Job = { id: number; kind: JobKind; status: "queued" | "running" | "done" | "error"; recipe: unknown; card: Card; progress: number; promptId: string | null; error: string | null; itemId: number | null; createdAt: number };
export type Item = { id: number; kind: "photo" | "clip"; file: string; poster: string | null; recipe: unknown; seed: number; cost: number; createdAt: number };
export type ComfySettings = { dailyCapUsd: number; keepWarmMaxH: number; idleMin: number; budgetUsd: number };
type Db = Database.Database;

/** Maps stored rows, skipping (and logging) any whose JSON is corrupt so one bad row can't break a list. */
function parsed<R extends { id: number }, T>(rows: R[], map: (r: R) => T, what: string): T[] {
  return rows.flatMap((r) => {
    try { return [map(r)]; } catch { console.warn(`comfy: skipping ${what} ${r.id} with unreadable JSON`); return []; }
  });
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comfy_vms (card TEXT PRIMARY KEY, vm_id TEXT NOT NULL, env TEXT NOT NULL, flavor TEXT NOT NULL, host TEXT NOT NULL, usd_hr REAL NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comfy_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, card TEXT NOT NULL, vm_id TEXT NOT NULL, usd_hr REAL NOT NULL, started_at INTEGER NOT NULL, stopped_at INTEGER, stop_reason TEXT);
CREATE TABLE IF NOT EXISTS comfy_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', recipe TEXT NOT NULL, card TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, prompt_id TEXT, error TEXT, item_id INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comfy_items (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, file TEXT NOT NULL, poster TEXT, recipe TEXT NOT NULL, seed INTEGER NOT NULL, cost REAL NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comfy_poses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, keypoints TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comfy_lora_info (name TEXT PRIMARY KEY, info TEXT, sha TEXT)`);
}

let migrated: Db | null = null;
/** The app db, migrated once. Lazy require keeps server-only db.ts out of unit tests. */
export function comfyDb(): Db {
  if (!migrated) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { db } = require("@/lib/db") as { db: Db };
    migrate(db);
    migrated = db;
  }
  return migrated;
}

// ---- VMs
type VmSql = { card: Card; vm_id: string; env: string; flavor: string; host: string; usd_hr: number; status: string };
export function getVm(db: Db, card: Card): VmRow | null {
  const r = db.prepare("SELECT * FROM comfy_vms WHERE card = ?").get(card) as VmSql | undefined;
  return r ? { card: r.card, vmId: r.vm_id, env: r.env, flavor: r.flavor, host: r.host, usdHr: r.usd_hr, status: r.status } : null;
}
export function putVm(db: Db, v: VmRow): void {
  db.prepare("INSERT OR REPLACE INTO comfy_vms (card, vm_id, env, flavor, host, usd_hr, status) VALUES (?,?,?,?,?,?,?)")
    .run(v.card, v.vmId, v.env, v.flavor, v.host, v.usdHr, v.status);
}
export function dropVm(db: Db, card: Card): void { db.prepare("DELETE FROM comfy_vms WHERE card = ?").run(card); }

// ---- Runs
export function openRun(db: Db, card: Card, vmId: string, usdHr: number, now: number): number {
  return Number(db.prepare("INSERT INTO comfy_runs (card, vm_id, usd_hr, started_at) VALUES (?,?,?,?)").run(card, vmId, usdHr, now).lastInsertRowid);
}
export function closeRun(db: Db, card: Card, now: number, reason: string): void {
  db.prepare("UPDATE comfy_runs SET stopped_at = ?, stop_reason = ? WHERE card = ? AND stopped_at IS NULL").run(now, reason, card);
}
export function runs(db: Db): Run[] {
  return (db.prepare("SELECT * FROM comfy_runs ORDER BY id").all() as { id: number; card: Card; vm_id: string; usd_hr: number; started_at: number; stopped_at: number | null; stop_reason: string | null }[])
    .map((r) => ({ id: r.id, card: r.card, vmId: r.vm_id, usdHr: r.usd_hr, startedAt: r.started_at, stoppedAt: r.stopped_at, stopReason: r.stop_reason }));
}

// ---- Jobs
type JobSql = { id: number; kind: JobKind; status: Job["status"]; recipe: string; card: Card; progress: number; prompt_id: string | null; error: string | null; item_id: number | null; created_at: number };
const toJob = (r: JobSql): Job => ({ id: r.id, kind: r.kind, status: r.status, recipe: JSON.parse(r.recipe), card: r.card, progress: r.progress, promptId: r.prompt_id, error: r.error, itemId: r.item_id, createdAt: r.created_at });
export function addJob(db: Db, kind: JobKind, recipe: unknown, card: Card, now: number): number {
  return Number(db.prepare("INSERT INTO comfy_jobs (kind, recipe, card, created_at) VALUES (?,?,?,?)").run(kind, JSON.stringify(recipe), card, now).lastInsertRowid);
}
export function readJob(db: Db, id: number): Job | null {
  const r = db.prepare("SELECT * FROM comfy_jobs WHERE id = ?").get(id) as JobSql | undefined;
  return r ? parsed([r], toJob, "job")[0] ?? null : null;
}
export function nextQueued(db: Db): Job | null {
  return parsed(db.prepare("SELECT * FROM comfy_jobs WHERE status = 'queued' ORDER BY id").all() as JobSql[], toJob, "job")[0] ?? null;
}
const JOB_COLS: Record<string, string> = { kind: "kind", status: "status", recipe: "recipe", card: "card", progress: "progress", promptId: "prompt_id", error: "error", itemId: "item_id" };
export function updateJob(db: Db, id: number, patch: Partial<Job>): void {
  const keys = Object.keys(patch).filter((k) => k in JOB_COLS && (patch as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE comfy_jobs SET ${keys.map((k) => `${JOB_COLS[k]} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => (k === "recipe" ? JSON.stringify(patch.recipe) : (patch as Record<string, unknown>)[k] as string | number | null)), id);
}

// ---- Items
type ItemSql = { id: number; kind: Item["kind"]; file: string; poster: string | null; recipe: string; seed: number; cost: number; created_at: number };
const toItem = (r: ItemSql): Item => ({ id: r.id, kind: r.kind, file: r.file, poster: r.poster, recipe: JSON.parse(r.recipe), seed: r.seed, cost: r.cost, createdAt: r.created_at });
export function addItem(db: Db, it: Omit<Item, "id">): number {
  return Number(db.prepare("INSERT INTO comfy_items (kind, file, poster, recipe, seed, cost, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(it.kind, it.file, it.poster, JSON.stringify(it.recipe), it.seed, it.cost, it.createdAt).lastInsertRowid);
}
export function readItem(db: Db, id: number): Item | null {
  const r = db.prepare("SELECT * FROM comfy_items WHERE id = ?").get(id) as ItemSql | undefined;
  return r ? parsed([r], toItem, "item")[0] ?? null : null;
}
/** Newest first; `before` is an item id cursor. */
export function listItems(db: Db, before?: number, limit = 50): Item[] {
  const rows = before == null
    ? db.prepare("SELECT * FROM comfy_items ORDER BY id DESC LIMIT ?").all(limit)
    : db.prepare("SELECT * FROM comfy_items WHERE id < ? ORDER BY id DESC LIMIT ?").all(before, limit);
  return parsed(rows as ItemSql[], toItem, "item");
}
/** The Library copy of NovelAI generation `generation`, if it was imported already. */
export function findImported(db: Db, generation: number): Item | null {
  const r = db.prepare("SELECT * FROM comfy_items WHERE json_extract(recipe, '$.source') = 'nai' AND json_extract(recipe, '$.generation') = ? LIMIT 1").get(generation) as ItemSql | undefined;
  return r ? parsed([r], toItem, "item")[0] ?? null : null;
}
export function deleteItem(db: Db, id: number): Item | null {
  const r = db.prepare("SELECT * FROM comfy_items WHERE id = ?").get(id) as ItemSql | undefined;
  if (!r) return null;
  db.prepare("DELETE FROM comfy_items WHERE id = ?").run(id);
  return parsed([r], toItem, "item")[0] ?? toItem({ ...r, recipe: "null" }); // still report the files to remove
}

// ---- Poses
export function savePose(db: Db, name: string, keypoints: number[]): number {
  return Number(db.prepare("INSERT INTO comfy_poses (name, keypoints) VALUES (?,?)").run(name, JSON.stringify(keypoints)).lastInsertRowid);
}
export function listPoses(db: Db): { id: number; name: string; keypoints: number[] }[] {
  return parsed(db.prepare("SELECT * FROM comfy_poses ORDER BY id").all() as { id: number; name: string; keypoints: string }[],
    (r) => ({ id: r.id, name: r.name, keypoints: JSON.parse(r.keypoints) as number[] }), "pose");
}

// ---- Settings + state (settings table, comfy.* keys, string values)
const get = (db: Db, k: string): string | null => (db.prepare("SELECT value FROM settings WHERE key = ?").get(`comfy.${k}`) as { value: string } | undefined)?.value ?? null;
const put = (db: Db, k: string, v: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`comfy.${k}`, v);
export function getJson<T>(db: Db, k: string): T | null {
  const v = get(db, k);
  if (v === null) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}
export function putJson(db: Db, k: string, v: unknown): void { put(db, k, JSON.stringify(v)); }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (db: Db, k: string, def: number, lo: number, hi: number) => {
  const v = get(db, k);
  return v === null || v.trim() === "" || !Number.isFinite(Number(v)) ? def : clamp(Number(v), lo, hi);
};

export function readSettings(db: Db): ComfySettings {
  return {
    dailyCapUsd: num(db, "dailyCapUsd", 10, 1, 200),
    keepWarmMaxH: num(db, "keepWarmMaxH", 6, 1, 24),
    idleMin: num(db, "idleMin", 50, 10, 240),
    budgetUsd: num(db, "budgetUsd", 20, 1, 1000),
  };
}
export function writeSettings(db: Db, s: Partial<ComfySettings>): ComfySettings {
  for (const k of ["dailyCapUsd", "keepWarmMaxH", "idleMin", "budgetUsd"] as const) {
    if (typeof s[k] === "number" && Number.isFinite(s[k])) put(db, k, String(s[k]));
  }
  return readSettings(db);
}

type State = { lastActivity: number; keepWarmUntil: number; boost: boolean; alarm: string | null };
export function getState(db: Db): State {
  return {
    lastActivity: Number(get(db, "lastActivity")) || 0,
    keepWarmUntil: Number(get(db, "keepWarmUntil")) || 0,
    boost: get(db, "boost") === "1",
    alarm: get(db, "alarm") || null,
  };
}
export function setState(db: Db, patch: Partial<State>): void {
  if (patch.lastActivity !== undefined) put(db, "lastActivity", String(patch.lastActivity));
  if (patch.keepWarmUntil !== undefined) put(db, "keepWarmUntil", String(patch.keepWarmUntil));
  if (patch.boost !== undefined) put(db, "boost", patch.boost ? "1" : "0");
  if (patch.alarm !== undefined) put(db, "alarm", patch.alarm ?? "");
}
