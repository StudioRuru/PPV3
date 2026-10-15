import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { DbIdentity, identityOf, slimePersona } from "./identity";
import { DEFAULT_MASCOT_SETTINGS as D } from "./settings";
import { blankSlime, EMPTY_BLOCK, resetLive } from "./slime";
import { SlimeStore, migrateSlimes } from "./slime-store";
import { MascotStore, migrateMascot } from "./store";

const mk = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  migrateMascot(db); migrateSlimes(db);
  let t = 0;
  const ms = new MascotStore(db, () => ++t);
  return { db, ms, id: new DbIdentity(db, ms) };
};

test("read: defaults, look from settings tags, memories newest-first and capped", () => {
  const { id, ms } = mk();
  for (let i = 0; i < 60; i++) ms.log("tap", `s${i}`, `l${i}`);
  ms.setFacts(Array.from({ length: 12 }, (_, i) => `f${i}`));
  const r = id.read();
  assert.equal(r.voice, D.voice);
  assert.equal(r.selfName, "Miyabi");
  assert.deepEqual(r.sliders, D.sliders);
  assert.deepEqual(r.look, { charTags: D.charTags, constantTags: D.constantTags, layerTags: D.layerTags, exprTags: D.exprTags, spriteDir: "" });
  assert.equal(r.memories.journal.length, 50);
  assert.equal(r.memories.journal[0].summary, "s59");
  assert.equal(r.memories.facts[0], "f11");
});

test("production round trip: extract -> insert other -> insert back restores the full live state", () => {
  const { id, ms, db } = mk();
  for (let i = 0; i < 60; i++) ms.log("tap", `s${i}`, `l${i}`);
  ms.setFacts(["old fact", "new fact"]);
  id.drift("idle"); // live brat drift, reset on insert
  const before = id.read();
  assert.equal(before.sliders.brat.live, 7);
  const s = new SlimeStore(db, id);
  const miyabi = s.ensureFirstRun()!;
  s.extract("Save", "#123456");
  const other = s.create({ ...blankSlime(), name: "Other", voice: "meek", selfName: "Kit", look: { ...blankSlime().look, spriteDir: "slimes/9" } });
  s.insert(other);
  assert.equal(id.read().voice, "meek");
  assert.equal(id.read().look.spriteDir, "slimes/9");
  assert.deepEqual(id.read().memories, { facts: [], journal: [] });
  s.insert(miyabi);
  assert.deepEqual(id.read(), { ...before, sliders: resetLive(before.sliders) });
  assert.equal(ms.needsRefresh(), false, "restored journal doesn't trigger a facts refresh");
});

test("write(null) -> Empty keeps the last look; write(state) clears it", () => {
  const { id } = mk();
  const look = id.read().look;
  id.write(null);
  const e = id.active(0);
  assert.equal(e.empty, true);
  assert.deepEqual(id.read().look, look);
  id.write({ ...id.read() });
  assert.equal(id.active(0).empty, false);
});

test("drift: brat +1 within cap on idle/dislike, heat only when allowed, never when Empty", () => {
  const { id } = mk();
  for (let i = 0; i < 6; i++) id.drift("idle");
  assert.deepEqual(id.read().sliders.brat, { value: 6, cap: 10, live: 10 });
  assert.equal(id.read().sliders.heat.live, undefined);
  id.drift("dislike");
  assert.equal(id.read().sliders.brat.live, 10);
  id.write(null);
  const before = id.read().sliders;
  id.drift("idle");
  assert.deepEqual(id.read().sliders, before);
});

test("identityOf: length shape from the effective length; Empty ignores sliders and mods", () => {
  const live = identityOf({ ...D, sliders: { ...D.sliders, length: { value: 2, cap: 10, live: 8 } } }, 30);
  assert.equal(live.lengthShape.quipPredict, 220);
  assert.equal(live.drift, 30);
  const empty = identityOf({ ...D, empty: true }, 30);
  assert.equal(empty.empty, true);
  assert.equal(empty.lengthShape.quipPredict, 60);
  assert.deepEqual(empty.mods, {});
});

test("slimePersona: voice, name and slider text; Empty = EMPTY_BLOCK only", () => {
  const p = slimePersona(identityOf({ ...D, voice: "You are Kit, a meek librarian.", selfName: "Kit", sliders: { ...D.sliders, heat: { value: 9, cap: 10 } } }, 0));
  assert.match(p, /# Personality: Kit/);
  assert.match(p, /meek librarian/);
  assert.doesNotMatch(p, /Hoshimi Miyabi/);
  assert.match(p, /Kit is a smug show-off/);
  assert.match(p, /Kit is overwhelmed by heat/);
  assert.match(p, /Keep replies to 1–2 sentences\./);
  assert.equal(slimePersona(identityOf({ ...D, empty: true }, 50)), EMPTY_BLOCK);
});
