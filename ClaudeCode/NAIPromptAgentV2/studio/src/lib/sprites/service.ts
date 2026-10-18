import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { estimate } from "../comfy/estimate";
import { drainQueue } from "../comfy/jobs";
import { type EditPreset, type EditJob, type SpriteJob, secondsFor, spriteRecipe } from "./graph";
import { addJob, deleteItem, readJob } from "../comfy/store";
import { COMFY_DIR } from "../env";
import { type Cell, type Surface, addTake, allowedKeys, approve, cell, cellStatus, edges, listKeys, reject, takes } from "./store";

type Db = Database.Database;
type Scope = "basic" | "all";
type Spec = { kind: "edit" | "sprite"; recipe: EditJob | SpriteJob };
const BASE = "@base";
const seed = () => Math.floor(Math.random() * 2 ** 32);
const kick = () => { void drainQueue().catch(() => {}); };

const itemOf = (db: Db, c: Cell): number | null =>
  c.approvedTake == null ? null : takes(db, c.id).find((t) => t.id === c.approvedTake)?.itemId ?? null;
const endpointItem = (db: Db, surface: Surface, outfit: string, key: string) => itemOf(db, cell(db, surface, outfit, key, ""));
const baseItem = (db: Db, surface: Surface, outfit: string) => itemOf(db, cell(db, surface, outfit, BASE, ""));

function edit(base: number, prompt: string, preset: EditPreset): EditJob {
  return { preset, base, prompt, seed: 0, width: 768, height: 1344, target: { takeId: 0 } };
}

/** What one take of this cell would run; seed and takeId are filled in by `enqueue`. */
function spec(db: Db, c: Cell, preset: EditPreset): Spec {
  const keys = listKeys(db, c.surface);
  const label = (k: string) => keys.find((x) => x.key === k)?.label ?? k;
  if (c.from === BASE) throw new Error("Use deriveBase for a base.");
  if (c.to === "") {
    const base = baseItem(db, c.surface, c.outfit);
    if (base == null) throw new Error("Approve the base first.");
    return { kind: "edit", recipe: edit(base, keys.find((k) => k.key === c.from)?.prompt ?? c.from, preset) };
  }
  const [start, end] = [endpointItem(db, c.surface, c.outfit, c.from), endpointItem(db, c.surface, c.outfit, c.to)];
  if (start == null || end == null) throw new Error("Approve both endpoints first.");
  const idle = c.from === c.to;
  const prompt = idle
    ? "subtle idle motion, breathing, a natural blink, slight sway, same pose, plain white background"
    : c.surface === "chat"
      ? `she changes expression from ${label(c.from)} to ${label(c.to)}, smooth natural motion, same character, plain white background`
      : `she moves from ${label(c.from)} to ${label(c.to)}, smooth natural body motion, confident teasing attitude, plain white background`;
  return { kind: "sprite", recipe: { surface: c.surface, start, end, prompt, seconds: secondsFor(c.surface, idle), seed: 0, target: { takeId: 0 } } };
}

function enqueue(db: Db, c: Cell, s: Spec, n: number, now: number, drain: () => void): number[] {
  const one = db.transaction(() => {
    const sd = seed();
    const takeId = addTake(db, c.id, null, sd, s.recipe);
    const id = addJob(db, s.kind, { ...s.recipe, seed: sd, target: { takeId } }, "main", now);
    db.prepare("UPDATE sprite_takes SET job_id = ?, recipe = ? WHERE id = ?").run(id, JSON.stringify({ ...s.recipe, seed: sd, target: { takeId } }), takeId);
    return id;
  });
  const ids = Array.from({ length: n }, () => one());
  drain();
  return ids;
}

export function generate(db: Db, cellId: number, n = 3, now = Date.now(), drain = kick, preset: EditPreset = "noct"): number[] {
  const c = cellById(db, cellId);
  return enqueue(db, c, spec(db, c, preset), n, now, drain);
}

function cellById(db: Db, id: number): Cell {
  const r = db.prepare("SELECT surface, outfit, from_key, to_key FROM sprite_cells WHERE id = ?").get(id) as { surface: Surface; outfit: string; from_key: string; to_key: string } | undefined;
  if (!r) throw new Error("No such cell.");
  return cell(db, r.surface, r.outfit, r.from_key, r.to_key);
}

/** Makes a Library item the approved base of (surface, outfit). */
export function setBase(db: Db, surface: Surface, outfit: string, itemId: number): void {
  const c = cell(db, surface, outfit, BASE, "");
  const t = addTake(db, c.id, null, 0, { source: "library" });
  db.prepare("UPDATE sprite_takes SET item_id = ? WHERE id = ?").run(itemId, t);
  approve(db, c.id, t);
}

export function deriveBase(db: Db, surface: Surface, outfit: string, fromSurface: Surface, fromOutfit: string, prompt: string, n = 3, now = Date.now(), drain = kick, preset: EditPreset = "noct"): number[] {
  const from = baseItem(db, fromSurface, fromOutfit);
  if (from == null) throw new Error("Approve the source base first.");
  return enqueue(db, cell(db, surface, outfit, BASE, ""), { kind: "edit", recipe: edit(from, prompt, preset) }, n, now, drain);
}

/** Deletes a Library item row and its mp4/poster files. */
export function dropItem(db: Db, id: number, dir = COMFY_DIR): void {
  const it = deleteItem(db, id);
  if (it) for (const f of [it.file, it.poster]) if (f) fs.rmSync(path.join(dir, path.basename(f)), { force: true });
}

/** Approve (dropping the other takes' items and files), reject, or toggle whether a Chat clip plays its mirror backwards. */
export function decide(db: Db, cellId: number, o: { approve?: number; reject?: true; own?: boolean }, dir = COMFY_DIR): void {
  if (o.approve != null) {
    // library-adopted takes (job_id null, from setBase) are the user's own items: never delete them
    const adopted = new Set(takes(db, cellId).filter((t) => t.jobId == null && t.itemId != null).map((t) => t.itemId));
    for (const id of approve(db, cellId, o.approve).dropItems) {
      if (adopted.has(id)) continue;
      dropItem(db, id, dir);
    }
  }
  if (o.reject) reject(db, cellId);
  // own = this cell gets its own clip (reverse off); !own plays its mirror backwards
  if (o.own != null) db.prepare("UPDATE sprite_cells SET reverse = ? WHERE id = ?").run(o.own ? 0 : 1, cellId);
}

const status = (db: Db, c: Cell) => cellStatus(c, takes(db, c.id), (id) => readJob(db, id)?.status ?? null);

/** Cells worth generating next: unapproved endpoints once the base is approved, then clips whose endpoints are approved. `only` narrows to one pose: its endpoint, idle and edge clips. */
export function missing(db: Db, surface: Surface, outfit: string, scope: Scope, only?: string): Cell[] {
  if (baseItem(db, surface, outfit) == null) return [];
  const keys = allowedKeys(listKeys(db, surface), scope === "basic" ? "tame" : "lewd", outfit).map((k) => k.key);
  const ok = (k: string) => endpointItem(db, surface, outfit, k) != null;
  const out: Cell[] = keys.filter((k) => !ok(k) && (only === undefined || k === only)).map((k) => cell(db, surface, outfit, k, ""))
    .filter((c) => !["approved", "queued", "generating", "review"].includes(status(db, c)));
  const pairs: [string, string][] = surface === "chat"
    ? keys.flatMap((a) => keys.map((b): [string, string] => [a, b]))
    : [...edges(db).filter(([a, b]) => keys.includes(a) && keys.includes(b)).flatMap(([a, b]): [string, string][] => [[a, b], [b, a]]), ...keys.map((k): [string, string] => [k, k])];
  for (const [a, b] of pairs) {
    if (only !== undefined && a !== only && b !== only) continue;
    if (!ok(a) || !ok(b)) continue;
    const c = cell(db, surface, outfit, a, b);
    if (!c.reverse && status(db, c) === "empty") out.push(c);
  }
  return out;
}

type Rate = { gpu: string; usdHr: number };
function liveRate(): Rate {
  // lazy: engine pulls in server-only deps (db, hyperstack) that unit tests must not load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = (require("../comfy/engine") as typeof import("../comfy/engine")).getEngine().view().main;
  return { gpu: m.gpu ?? "", usdHr: m.usdHr };
}

export function bulkEstimate(db: Db, surface: Surface, outfit: string, scope: Scope, takes = 3, rate?: Rate, only?: string): { jobs: number; seconds: number; usd: number } {
  const cells = missing(db, surface, outfit, scope, only);
  const r = rate ?? liveRate();
  let seconds = 0, usd = 0;
  for (const c of cells) {
    const s = spec(db, c, "noct");
    const e = estimate(s.kind === "edit" ? (s.recipe as EditJob) : spriteRecipe(s.recipe as SpriteJob), r.gpu, r.usdHr);
    seconds += e.seconds * takes; usd += e.usd * takes;
  }
  return { jobs: cells.length * takes, seconds, usd };
}

/** Enqueues `takes` jobs for every missing cell; returns the job count. */
export function bulkStart(db: Db, surface: Surface, outfit: string, scope: Scope, takesEach = 3, now = Date.now(), drain = kick, only?: string): number {
  const cells = missing(db, surface, outfit, scope, only);
  const n = cells.reduce((sum, c) => sum + enqueue(db, c, spec(db, c, "noct"), takesEach, now, () => {}).length, 0);
  drain();
  return n;
}

/** Fails queued jobs of this surface+outfit; running ones finish. Returns how many were cancelled. */
export function bulkCancel(db: Db, surface: Surface, outfit: string): number {
  return db.prepare(`UPDATE comfy_jobs SET status = 'error', error = 'Cancelled.' WHERE status = 'queued' AND kind IN ('sprite','edit') AND id IN
    (SELECT t.job_id FROM sprite_takes t JOIN sprite_cells c ON c.id = t.cell_id WHERE c.surface = ? AND c.outfit = ? AND t.job_id IS NOT NULL)`).run(surface, outfit).changes;
}
