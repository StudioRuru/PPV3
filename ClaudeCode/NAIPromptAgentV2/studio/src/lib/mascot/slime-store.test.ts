import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { blankSlime } from "./slime";
import { SlimeStore, migrateSlimes, type LiveIdentity, type LiveState } from "./slime-store";

const liveOf = (voice: string, fact: string): LiveState => {
  const b = blankSlime();
  return {
    voice, selfName: "Miyabi", mods: { bratty: true }, heatDrift: true, look: { ...b.look, charTags: `girl, ${voice}` },
    sliders: { ...b.sliders, brat: { value: 3, cap: 8, live: 6 }, heat: { value: 1, cap: 5 } },
    memories: { facts: [fact], journal: [{ kind: "tap", summary: "s", line: "l", created_at: 5 }] },
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
  const { voice, selfName, sliders, mods, heatDrift, look, memories } = doc;
  assert.deepEqual({ voice, selfName, sliders, mods, heatDrift, look, memories }, before);
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
  assert.deepEqual(s.get(miyabi)!.memories.facts, ["likes cats", "new fact"]);
  s.insert(miyabi);
  const st = live.state!;
  assert.equal(st.voice, "smug");
  assert.deepEqual(st.memories.facts, ["likes cats", "new fact"]);
  assert.deepEqual(st.sliders.brat, { value: 3, cap: 8 });
  assert.equal(st.look.charTags, "girl, smug");
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
