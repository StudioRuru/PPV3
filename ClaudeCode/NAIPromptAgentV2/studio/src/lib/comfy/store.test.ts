import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrate, readSettings, writeSettings, openRun, closeRun, runs, addJob, nextQueued, updateJob, readJob, getState, setState, addItem, findImported } from "./store";

const mk = () => { const db = new Database(":memory:"); migrate(db); return db; };

test("migrate is idempotent", () => {
  const db = mk();
  assert.doesNotThrow(() => migrate(db));
});

test("settings default and clamp", () => {
  const db = mk();
  assert.deepEqual(readSettings(db), { dailyCapUsd: 10, keepWarmMaxH: 6, idleMin: 50, budgetUsd: 20 });
  const s = writeSettings(db, { dailyCapUsd: 0, keepWarmMaxH: 99 });
  assert.equal(s.dailyCapUsd, 1);
  assert.equal(s.keepWarmMaxH, 24);
  assert.equal(readSettings(db).idleMin, 50);
});

test("runs open and close per card", () => {
  const db = mk();
  openRun(db, "main", "vm1", 0.8, 1000);
  closeRun(db, "main", 4600, "idle");
  closeRun(db, "main", 9999, "again");
  const r = runs(db)[0];
  assert.equal(r.stoppedAt, 4600);
  assert.equal(r.stopReason, "idle");
});

test("jobs queue FIFO", () => {
  const db = mk();
  const a = addJob(db, "photo", { p: 1 }, "main", 1);
  const b = addJob(db, "video", { p: 2 }, "main", 2);
  assert.equal(nextQueued(db)?.id, a);
  updateJob(db, a, { status: "running" });
  assert.equal(nextQueued(db)?.id, b);
});

test("recipe round-trips as JSON", () => {
  const db = mk();
  const recipe = { prompt: "x", loras: [{ n: "a", w: 0.5 }] };
  const id = addJob(db, "photo", recipe, "boost", 1);
  assert.deepEqual(readJob(db, id)?.recipe, recipe);
});

test("state defaults and patch", () => {
  const db = mk();
  assert.deepEqual(getState(db), { lastActivity: 0, keepWarmUntil: 0, boost: false, alarm: null });
  setState(db, { boost: true, alarm: "x", lastActivity: 5 });
  assert.deepEqual(getState(db), { lastActivity: 5, keepWarmUntil: 0, boost: true, alarm: "x" });
  setState(db, { alarm: null });
  assert.equal(getState(db).alarm, null);
});

test("a blank setting falls back to the default", () => {
  const db = mk();
  db.prepare("INSERT INTO settings (key, value) VALUES ('comfy.idleMin', '')").run();
  assert.equal(readSettings(db).idleMin, 50);
});

test("a corrupt stored row is skipped, not thrown", () => {
  const db = mk();
  const bad = addJob(db, "photo", {}, "main", 1);
  const good = addJob(db, "photo", { a: 1 }, "main", 2);
  db.prepare("UPDATE comfy_jobs SET recipe = '{oops' WHERE id = ?").run(bad);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(readJob(db, bad), null);
    assert.equal(nextQueued(db)?.id, good);
  } finally { console.warn = warn; }
});

test("findImported finds the Library copy of a NovelAI image", () => {
  const db = mk();
  const it = { kind: "photo" as const, poster: null, seed: 7, cost: 0, createdAt: 1 };
  addItem(db, { ...it, file: "a.png", recipe: { source: "import" } });
  const id = addItem(db, { ...it, file: "b.png", recipe: { source: "nai", generation: 42 } });
  assert.equal(findImported(db, 42)?.id, id);
  assert.equal(findImported(db, 41), null);
});
