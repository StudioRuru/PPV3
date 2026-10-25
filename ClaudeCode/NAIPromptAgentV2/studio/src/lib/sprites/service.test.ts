import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate, addJob, readJob, addItem, readItem, updateJob } from "../comfy/store";
import { cell, listKeys, migrateSprites, takes, addTake, linkTakeItem, approve, edges } from "./store";
import { type SpriteJob, spriteRecipe } from "./graph";
import { estimate } from "../comfy/estimate";
import { generate, setBase, deriveBase, decide, missing, bulkEstimate, bulkStart, bulkCancel } from "./service";

let db: Database.Database;
const noop = () => {};
const dirs: string[] = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { db = new Database(":memory:"); migrate(db); migrateSprites(db); });

const BASIC = (() => { const d = new Database(":memory:"); migrateSprites(d); return listKeys(d, "chat").filter((k) => k.tier === "tame").map((k) => k.key); })();
const STAGE14 = ["stand", "look_left", "look_right", "look_up", "face_viewer", "face_away", "check_nails", "sit", "squat", "stretch_legs", "lie_down", "hip_pop", "hair_twirl", "kneel"];

function approveEndpoint(key: string, itemId: number, surface: "chat" | "stage" = "chat") {
  if (!cell(db, surface, "day", "@base", "").approvedTake) setBase(db, surface, "day", 1);
  const c = cell(db, surface, "day", key, "");
  const t = addTake(db, c.id, null, 1, {}); linkTakeItem(db, t, itemId); approve(db, c.id, t);
}

test("clip generate needs approved endpoints", () => {
  const c = cell(db, "chat", "day", "happy", "sad");
  assert.throws(() => generate(db, c.id, 3, 0, noop), /Approve both endpoints first\./);
});
test("generate queues n sprite jobs with distinct seeds and take rows", () => {
  approveEndpoint("happy", 10); approveEndpoint("sad", 11);
  const c = cell(db, "chat", "day", "happy", "sad");
  const ids = generate(db, c.id, 3, 0, noop);
  assert.equal(ids.length, 3);
  const r = ids.map((id) => readJob(db, id)!.recipe as SpriteJob);
  assert.deepEqual(r.map((x) => [x.start, x.end, x.seconds]), Array(3).fill([10, 11, 0.75]));
  assert.equal(new Set(r.map((x) => x.seed)).size, 3);
  const ts = takes(db, c.id);
  assert.equal(ts.length, 3);
  assert.deepEqual(ts.map((t) => t.jobId), ids);
  assert.deepEqual(r.map((x) => x.target.takeId), ts.map((t) => t.id));
});
test("endpoint generate queues edit jobs from the approved base", () => {
  setBase(db, "chat", "day", 77);
  const ids = generate(db, cell(db, "chat", "day", "happy", "").id, 2, 0, noop);
  const j = readJob(db, ids[0])!;
  assert.equal(j.kind, "edit");
  assert.equal((j.recipe as { base: number; preset: string }).base, 77);
  assert.equal((j.recipe as { preset: string }).preset, "pose");
  assert.throws(() => generate(db, cell(db, "chat", "night", "happy", "").id, 1, 0, noop), /base/i);
});
test("deriveBase edits the target base from another approved base", () => {
  setBase(db, "chat", "day", 5);
  const ids = deriveBase(db, "stage", "day", "chat", "day", "full body", 2, 0, noop);
  assert.equal(ids.length, 2);
  assert.equal((readJob(db, ids[0])!.recipe as { base: number }).base, 5);
  assert.equal(takes(db, cell(db, "stage", "day", "@base", "").id).length, 2);
});
test("missing chat set skips reverse pairs and counts idles", () => {
  assert.equal(BASIC.length, 8);
  BASIC.forEach((k, i) => approveEndpoint(k, 100 + i));
  assert.equal(missing(db, "chat", "day", "basic").length, 8 * 7 / 2 + 8);
});
test("missing stage set = both directions of each edge + idles", () => {
  STAGE14.forEach((k, i) => approveEndpoint(k, 200 + i, "stage"));
  assert.equal(edges(db).length, 20);
  assert.equal(missing(db, "stage", "day", "all").length, 20 * 2 + 14);
});
test("missing with a key: its endpoint, idle and edge clips to approved neighbours only", () => {
  setBase(db, "stage", "day", 1);
  assert.deepEqual(missing(db, "stage", "day", "all", "sit").map((c) => [c.from, c.to]), [["sit", ""]]);
  ["sit", "stand", "kneel"].forEach((k, i) => approveEndpoint(k, 300 + i, "stage"));
  const got = missing(db, "stage", "day", "all", "sit").map((c) => `${c.from}>${c.to}`).sort();
  const nb = edges(db).filter(([a, b]) => (a === "sit" || b === "sit") && [a, b].every((x) => ["sit", "stand", "kneel"].includes(x))).length;
  assert.equal(got.length, nb * 2 + 1);
  assert.ok(got.includes("sit>sit") && got.every((g) => g.includes("sit")));
  assert.equal(missing(db, "stage", "day", "all", "nope").length, 0);
  assert.equal(missing(db, "stage", "day", "all", "").length, 0);
});
test("missing endpoints need an approved base", () => {
  assert.equal(missing(db, "chat", "day", "basic").length, 0);
  setBase(db, "chat", "day", 1);
  assert.equal(missing(db, "chat", "day", "basic").length, 8);
});
test("bulkEstimate sums per-take estimates without queuing", () => {
  BASIC.forEach((k, i) => approveEndpoint(k, 100 + i));
  const e = bulkEstimate(db, "chat", "day", "basic", 3, { gpu: "A6000", usdHr: 1 });
  assert.equal(e.jobs, (28 + 8) * 3); assert.ok(e.usd > 0); assert.ok(e.seconds > 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM comfy_jobs").get() as { n: number }).n, 0);
  assert.equal(bulkStart(db, "chat", "day", "basic", 3, 0, noop), 36 * 3);
});
test("clip prompts start with the trigger and bulkEstimate prices 720p", () => {
  approveEndpoint("happy", 10); approveEndpoint("sad", 11);
  const ids = generate(db, cell(db, "chat", "day", "happy", "sad").id, 1, 0, noop);
  assert.ok((readJob(db, ids[0])!.recipe as SpriteJob).prompt.startsWith("miyabi_sprite, "));
  const rate = { gpu: "A6000", usdHr: 1 };
  const r = { ...spriteRecipe({ surface: "chat", start: 1, end: 2, prompt: "", seconds: 0.75, seed: 1, target: { takeId: 1 } }) };
  assert.ok(estimate(r, rate.gpu, rate.usdHr).seconds > estimate({ ...r, size: "480p" }, rate.gpu, rate.usdHr).seconds);
});
test("approve deletes dropped take files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sprites-svc-")); dirs.push(dir);
  const c = cell(db, "chat", "day", "happy", "");
  const mk = (n: string) => {
    fs.writeFileSync(path.join(dir, n), "x");
    const item = addItem(db, { kind: "photo", file: n, poster: null, recipe: {}, seed: 1, cost: 0, createdAt: 0 });
    const t = addTake(db, c.id, 5, 1, {}); linkTakeItem(db, t, item); return { t, item, n };
  };
  const a = mk("a.png"), b = mk("b.png");
  decide(db, c.id, { approve: a.t }, dir);
  assert.ok(fs.existsSync(path.join(dir, "a.png")));
  assert.ok(!fs.existsSync(path.join(dir, "b.png")));
  assert.equal(readItem(db, b.item), null); assert.ok(readItem(db, a.item));
  assert.equal(cell(db, "chat", "day", "happy", "").approvedTake, a.t);
});
test("decide reject and own", () => {
  const c = cell(db, "chat", "day", "sad", "happy");
  assert.equal(c.reverse, true);
  decide(db, c.id, { own: true }); assert.equal(cell(db, "chat", "day", "sad", "happy").reverse, false);
  decide(db, c.id, { own: false }); assert.equal(cell(db, "chat", "day", "sad", "happy").reverse, true);
  decide(db, c.id, { reject: true }); assert.equal(cell(db, "chat", "day", "sad", "happy").rejected, true);
});
test("bulkCancel fails only queued jobs of that outfit", () => {
  const mkJob = (kind: "sprite" | "edit", outfit: string, status: "queued" | "running") => {
    const c = cell(db, "chat", outfit, "happy", "sad");
    const t = addTake(db, c.id, null, 1, {});
    const id = addJob(db, kind, { target: { takeId: t } }, "main", 0);
    db.prepare("UPDATE sprite_takes SET job_id = ? WHERE id = ?").run(id, t);
    updateJob(db, id, { status }); return id;
  };
  const dayQ = mkJob("sprite", "day", "queued"), nightQ = mkJob("sprite", "night", "queued"), dayR = mkJob("edit", "day", "running");
  assert.equal(bulkCancel(db, "chat", "day"), 1);
  assert.equal(readJob(db, dayQ)!.status, "error"); assert.equal(readJob(db, dayQ)!.error, "Cancelled.");
  assert.equal(readJob(db, nightQ)!.status, "queued"); assert.equal(readJob(db, dayR)!.status, "running");
});
test("approving a generated take never deletes an adopted library base", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sprites-svc-")); dirs.push(dir);
  fs.writeFileSync(path.join(dir, "lib.png"), "x"); fs.writeFileSync(path.join(dir, "gen.png"), "x");
  const mk = (n: string) => addItem(db, { kind: "photo", file: n, poster: null, recipe: {}, seed: 1, cost: 0, createdAt: 0 });
  const lib = mk("lib.png"), gen = mk("gen.png");
  setBase(db, "chat", "day", lib);
  const c = cell(db, "chat", "day", "@base", "");
  const t = addTake(db, c.id, 99, 1, {}); linkTakeItem(db, t, gen);
  decide(db, c.id, { approve: t }, dir);
  assert.ok(readItem(db, lib)); assert.ok(fs.existsSync(path.join(dir, "lib.png")));
  assert.equal(cell(db, "chat", "day", "@base", "").approvedTake, t);
});
