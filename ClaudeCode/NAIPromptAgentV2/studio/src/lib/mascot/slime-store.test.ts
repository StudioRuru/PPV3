import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { blankSlime, mixSliders } from "./slime";
import { SlimeStore, migrateSlimes, type LiveIdentity, type LiveState } from "./slime-store";

const liveOf = (voice: string, fact: string): LiveState => {
  const b = blankSlime();
  return {
    voice, selfName: "Miyabi", heatDrift: true, look: { ...b.look, charTags: `girl, ${voice}` },
    sliders: { ...b.sliders, brat: { value: 3, cap: 8, live: 6 }, heat: { value: 1, cap: 5 } },
    memories: { facts: [fact], journal: [{ kind: "tap", summary: "s", line: "l", created_at: 5 }] },
    vials: [{ name: "Brew", color: "#123456", effect: "e", doses: [{ seq: 0, delta: {} }] }],
  };
};

class FakeLive implements LiveIdentity {
  state: LiveState | null = liveOf("smug", "likes cats");
  writes: (LiveState | null)[] = [];
  fail = false;
  read() { if (!this.state) throw new Error("empty"); return structuredClone(this.state); }
  write(s: LiveState | null) { if (this.fail) throw new Error("boom"); this.writes.push(s); this.state = structuredClone(s); }
}

const mk = () => { const db = new Database(":memory:"); migrateSlimes(db); migrateSlimes(db); const live = new FakeLive(); return { db, live, s: new SlimeStore(db, live) }; };

test("first run snapshots live into active jar 'Miyabi', losslessly and idempotently", () => {
  const { s, live } = mk();
  const before = structuredClone(live.state!);
  const id = s.ensureFirstRun()!;
  assert.equal(s.ensureFirstRun(), id);
  assert.equal(s.list().length, 1);
  assert.equal(s.activeId(), id);
  const doc = s.get(id)!;
  assert.equal(doc.name, "Miyabi");
  assert.equal(doc.color, "#b7a4ff");
  assert.equal(doc.origin, "miyabi");
  const { voice, selfName, sliders, heatDrift, look, memories, vials } = doc;
  assert.deepEqual({ voice, selfName, sliders, heatDrift, look, memories, vials }, before);
  assert.equal(live.writes.length, 0);
});

test("first run does nothing when any jar exists", () => {
  const { s } = mk();
  s.create({ ...blankSlime(), name: "Other" });
  assert.equal(s.ensureFirstRun(), null);
  assert.equal(s.list().length, 1);
  assert.equal(s.activeId(), null);
});

test("extract -> insert another -> insert back restores everything, live sliders reset", () => {
  const { s, live } = mk();
  const miyabi = s.ensureFirstRun()!;
  const saved = s.extract("Save point", "#112233");
  assert.equal(s.get(saved)!.sliders.brat.live, 6);
  assert.equal(s.activeId(), miyabi);
  const other = s.create({ ...blankSlime(), name: "Other", voice: "meek" });
  live.state!.memories.facts.push("new fact");
  s.insert(other);
  assert.equal(s.activeId(), other);
  assert.equal(live.state!.voice, "meek");
  assert.deepEqual(live.state!.vials, [], "other jar's (no) vials go live");
  assert.equal(s.get(saved)!.vials[0].name, "Brew", "extract carries live vials");
  assert.deepEqual(s.get(miyabi)!.memories.facts, ["likes cats", "new fact"]);
  s.insert(miyabi);
  const st = live.state!;
  assert.equal(st.voice, "smug");
  assert.deepEqual(st.memories.facts, ["likes cats", "new fact"]);
  assert.deepEqual(st.sliders.brat, { value: 3, cap: 8 });
  assert.equal(st.look.charTags, "girl, smug");
  assert.equal(st.vials[0].name, "Brew", "vials snapshot into the jar and back");
  const n = live.writes.length;
  s.insert(miyabi);
  assert.equal(live.writes.length, n, "re-inserting active is a no-op");
});

test("remove -> Empty, active null, jar updated with latest memories", () => {
  const { s, live } = mk();
  const id = s.ensureFirstRun()!;
  live.state!.memories.facts.push("latest");
  const removed = s.remove();
  assert.equal(removed!.name, "Miyabi");
  assert.deepEqual(removed!.memories.facts, ["likes cats", "latest"]);
  assert.equal(live.writes.at(-1), null);
  assert.equal(s.activeId(), null);
  assert.deepEqual(s.get(id)!.memories.facts, ["likes cats", "latest"]);
  assert.equal(s.remove(), null);
});

test("delete refuses the active jar, deletes others", () => {
  const { s } = mk();
  const id = s.ensureFirstRun()!;
  assert.throws(() => s.delete(id), /active/);
  const other = s.create({ ...blankSlime(), name: "Other" });
  s.delete(other);
  assert.equal(s.get(other), null);
});

test("save merges and re-validates; invalid writes throw", () => {
  const { s } = mk();
  const id = s.ensureFirstRun()!;
  s.save(id, { name: "Miya", color: "#000000" });
  assert.equal(s.get(id)!.name, "Miya");
  assert.equal(s.get(id)!.voice, "smug");
  assert.throws(() => s.save(id, { color: "red" }), /invalid/i);
  assert.throws(() => s.create({ ...blankSlime(), name: "" }), /invalid/i);
  assert.throws(() => s.save(999, { name: "x" }), /not found/i);
});

test("a throwing live.write during insert rolls back active id and jars", () => {
  const { s, live } = mk();
  const miyabi = s.ensureFirstRun()!;
  const other = s.create({ ...blankSlime(), name: "Other" });
  const before = s.list();
  live.state!.memories.facts.push("unsaved");
  live.fail = true;
  assert.throws(() => s.insert(other), /boom/);
  assert.equal(s.activeId(), miyabi);
  assert.deepEqual(s.list(), before);
  assert.throws(() => s.remove(), /boom/);
  assert.equal(s.activeId(), miyabi);
  assert.deepEqual(s.list(), before);
});

test("extract refuses while Empty", () => {
  const { s } = mk();
  s.ensureFirstRun();
  s.remove();
  assert.throws(() => s.extract("x", "#000000"), /Nothing to extract — insert a slime first/);
});

test("a dangling active pointer is treated as Empty and cleared", () => {
  const { s, db, live } = mk();
  const id = s.ensureFirstRun()!;
  db.prepare("DELETE FROM mascot_slimes WHERE id = ?").run(id);
  assert.equal(s.activeId(), null);
  assert.equal(live.writes.at(-1), null, "live goes Empty too");
  assert.equal((db.prepare("SELECT value FROM mascot_meta WHERE key = 'active_slime'").get() as { value: string }).value, "");
  assert.equal(s.remove(), null);
  const other = s.create({ ...blankSlime(), name: "Other" });
  s.insert(other);
  assert.equal(s.activeId(), other);
});

test("create/extract default an empty selfName to the jar name", () => {
  const { s, live } = mk();
  s.ensureFirstRun();
  assert.equal(s.get(s.create({ ...blankSlime(), name: "Kit" }))!.selfName, "Kit");
  live.state!.selfName = "";
  assert.equal(s.get(s.extract("Echo", "#000000"))!.selfName, "Echo");
});

test("generation bumps on insert/remove/extract so detached work can detect a switch", () => {
  const { s } = mk();
  const id = s.ensureFirstRun()!;
  const g0 = s.generation;
  s.extract("Save", "#112233");
  assert.ok(s.generation > g0);
  const g1 = s.generation;
  s.remove();
  assert.ok(s.generation > g1);
  const g2 = s.generation;
  s.insert(id);
  assert.ok(s.generation > g2);
});

/** Raw pre-plan-20 jar: 5 sliders + mods, no tease/flirt, inserted straight into the table. */
const oldJar = (db: Database.Database, mods: object) => {
  const d = JSON.parse(JSON.stringify(blankSlime())) as Record<string, any>;
  delete d.sliders.tease; delete d.sliders.flirt; d.name = "Old"; d.mods = mods;
  return Number(db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES (?, 1, 1)").run(JSON.stringify(d)).lastInsertRowid);
};

test("plan 20: old jars migrate on read (get/list), from the jar's own mods", () => {
  const { s, db } = mk();
  const id = oldJar(db, { tease: true, flirt: false });
  for (const d of [s.get(id)!, s.list().find((r) => r.id === id)!.doc]) {
    assert.deepEqual([d.sliders.tease, d.sliders.flirt], [{ value: 6, cap: 10 }, { value: 0, cap: 10 }]);
    assert.equal("mods" in d, false);
  }
});

test("plan 20: insert(old jar) takes tease/flirt from the jar, not the previous slime; snapshot keeps them", () => {
  const { s, db, live } = mk();
  live.state!.sliders.tease = { value: 9, cap: 10 }; live.state!.sliders.flirt = { value: 9, cap: 10 };
  const first = s.ensureFirstRun()!;
  const id = oldJar(db, { tease: true, flirt: false });
  s.insert(id);
  assert.deepEqual([live.state!.sliders.tease, live.state!.sliders.flirt], [{ value: 6, cap: 10 }, { value: 0, cap: 10 }]);
  s.insert(first); // snapshots the old jar from live
  assert.deepEqual([s.get(id)!.sliders.tease, s.get(id)!.sliders.flirt], [{ value: 6, cap: 10 }, { value: 0, cap: 10 }]);
});

test("plan 20: mix old x new and new x old keeps tease/flirt", () => {
  const { s, db } = mk();
  const o = s.get(oldJar(db, { tease: true, flirt: true }))!;
  const n = { ...blankSlime(), name: "New" }; n.sliders.tease = { value: 2, cap: 10 };
  for (const [a, b] of [[o, n], [n, o]]) {
    const m = mixSliders(a.sliders, b.sliders, 50);
    assert.ok(m.tease && m.flirt);
  }
  assert.equal(mixSliders(o.sliders, n.sliders, 50).tease.value, 4);
});

test("plan 20: an unparseable stored jar is skipped by list and null from get (never throws)", () => {
  const { s, db } = mk();
  const bad = Number(db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES ('{\"nope\":1}', 1, 1)").run().lastInsertRowid);
  assert.equal(s.get(bad), null);
  assert.equal(s.list().some((r) => r.id === bad), false);
  const txt = Number(db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES ('not json', 1, 1)").run().lastInsertRowid);
  assert.equal(s.get(txt), null);
  assert.equal(s.list().some((r) => r.id === txt), false);
});

test("plan 20: active pointer on an existing-but-invalid row never resets the live identity; a missing row still does", () => {
  const { s, db, live } = mk();
  const bad = Number(db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES ('not json', 1, 1)").run().lastInsertRowid);
  db.prepare("INSERT OR REPLACE INTO mascot_meta (key, value) VALUES ('active_slime', ?)").run(String(bad));
  const before = structuredClone(live.state);
  assert.equal(s.activeId(), bad); // kept: nothing destructive
  assert.equal(live.writes.length, 0);
  assert.deepEqual(live.state, before);
  db.prepare("DELETE FROM mascot_slimes WHERE id = ?").run(bad);
  assert.equal(s.activeId(), null);
  assert.deepEqual(live.writes, [null]);
});

test("plan 20: an unreadable active jar can be swapped out, removed, extracted from, then deleted", () => {
  const mkBad = () => {
    const m = mk();
    const bad = Number(m.db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES ('not json', 1, 1)").run().lastInsertRowid);
    m.db.prepare("INSERT OR REPLACE INTO mascot_meta (key, value) VALUES ('active_slime', ?)").run(String(bad));
    return { ...m, bad };
  };
  { const { s, bad } = mkBad(); const other = s.create({ ...blankSlime(), name: "Other" });
    s.insert(other); assert.equal(s.activeId(), other); s.delete(bad); }
  { const { s, live, bad } = mkBad(); assert.equal(s.remove(), null);
    assert.equal(s.activeId(), null); assert.deepEqual(live.writes, [null]); s.delete(bad); }
  { const { s, bad } = mkBad(); const x = s.extract("Copy", "#112233");
    assert.equal(s.get(x)!.name, "Copy"); assert.equal(s.activeId(), bad); }
});
