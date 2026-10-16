import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { blankSlime } from "./slime";
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
