import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MascotStore, migrateMascot, factsPrompt, parseFacts } from "./store";

const mk = (now = () => Date.now()) => { const db = new Database(":memory:"); migrateMascot(db); migrateMascot(db); return new MascotStore(db, now); };

test("journal caps at 300 and recent is newest-first", () => {
  const s = mk();
  for (let i = 0; i < 310; i++) s.log("tap", `s${i}`, `l${i}`);
  const r = s.recent(500);
  assert.equal(r.length, 300);
  assert.equal(r[0].summary, "s309");
  assert.equal(r[299].summary, "s10");
  assert.equal(s.recent(5).length, 5);
});

test("setFacts caps 12 x 160, drops empties; delete/clear", () => {
  const s = mk();
  s.setFacts(Array.from({ length: 15 }, (_, i) => `fact ${i}`.padEnd(200, "x")));
  const f = s.facts();
  assert.equal(f.length, 12);
  assert.ok(f.every((x) => x.text.length === 160));
  s.setFacts(["a", "  ", "b"]);
  assert.deepEqual(s.facts().map((x) => x.text), ["a", "b"]);
  s.deleteFact(s.facts()[0].id);
  assert.deepEqual(s.facts().map((x) => x.text), ["b"]);
  s.clearFacts();
  assert.equal(s.facts().length, 0);
});

test("needsRefresh by count and by age", () => {
  let t = 1_000_000;
  const s = mk(() => t);
  assert.equal(s.needsRefresh(), false);
  for (let i = 0; i < 24; i++) s.log("tap", "x", "y");
  assert.equal(s.needsRefresh(), false);
  s.log("tap", "x", "y");
  assert.equal(s.needsRefresh(), true);
  s.markRefreshed();
  assert.equal(s.needsRefresh(), false);
  s.log("tap", "x", "y");
  assert.equal(s.needsRefresh(), false);
  t += 24 * 3600_000 + 1;
  assert.equal(s.needsRefresh(), true);
  s.markRefreshed();
  t += 25 * 3600_000;
  assert.equal(s.needsRefresh(), false); // nothing new to learn from
});

test("parseFacts: bullets, numbered, garbage, dupes, caps", () => {
  assert.deepEqual(parseFacts("Here:\n- likes tea\n* night owl\n1. likes tea\n2) torn clothes\n\n  \n"), ["likes tea", "night owl", "torn clothes"].slice(0, 3));
  assert.deepEqual(parseFacts("no bullets at all"), []);
  assert.equal(parseFacts(Array.from({ length: 20 }, (_, i) => `- f${i}`).join("\n")).length, 12);
  assert.equal(parseFacts("- " + "y".repeat(300))[0].length, 160);
});

test("factsPrompt quotes journal/taste/current as data", () => {
  const p = factsPrompt([{ id: 1, created_at: 0, kind: "tap", summary: "sum", line: "hi" }], "taste!", ["old"]);
  assert.match(p.system, /12/);
  assert.match(p.user, /sum/);
  assert.match(p.user, /taste!/);
  assert.match(p.user, /old/);
});

test("fresh install: first journal rows don't trigger a refresh (marker seeded on first read)", () => {
  let t = 1_800_000_000_000;
  const s = mk(() => t);
  s.log("tap", "x", "y");
  assert.equal(s.needsRefresh(), false);
  t += 24 * 3600_000 + 1;
  assert.equal(s.needsRefresh(), true);
});
