import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateChat, ThreadStore } from "../threads";
import { migrateNotebook, Notebook } from "./notebook";
import { foldOnce, parseOps, bumpTurn, currentTurn } from "./fold";

function setup(n: number) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)");
  migrateChat(db); migrateNotebook(db);
  const store = new ThreadStore(db), notes = new Notebook(db);
  const id = store.create("t", "miyabi", "companion");
  store.replace(id, Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })) as never);
  return { store, notes, id };
}
const say = (...parts: string[]) => async function* () { for (const p of parts) yield p; };
const deps = (s: ReturnType<typeof setup>, stream: () => AsyncIterable<string>, turn = () => 0) => ({ store: s.store, notes: s.notes, stream, turn, name: "Miyabi" });

test("parseOps accepts fenced json", () => assert.deepEqual(parseOps('Sure!\n```json\n{"add":[{"kind":"fact","text":"likes tea"}]}\n```'), { add: [{ kind: "fact", text: "likes tea" }] }));

test("parseOps drops bad entries and returns {} for an empty object", () => {
  assert.deepEqual(parseOps(JSON.stringify({ add: [{ kind: "stance", text: "x" }, { kind: "fact", text: 3 }, { kind: "moment", text: "ok" }], update: [{ id: 1.5, text: "x" }, { id: 2, text: "y" }, { id: 3 }], remove: [1, "2", 3.5, 4], stance: "" })),
    { add: [{ kind: "moment", text: "ok" }], update: [{ id: 2, text: "y" }], remove: [1, 4] });
  assert.deepEqual(parseOps("{}"), {});
  assert.equal(parseOps("lol"), null);
  assert.equal(parseOps("[1]"), null);
});

test("folds settled messages and advances the mark", async () => {
  const s = setup(8); // settled = 6
  const r = await foldOnce(s.id, deps(s, say('{"add":[{"kind":"fact","text":"likes tea"}],', '"stance":"warming up"}')));
  assert.equal(r, "done");
  assert.equal(s.store.foldState(s.id)!.folded, 6);
  const live = s.notes.live();
  assert.equal(live.find((n) => n.text === "likes tea")!.msg_index, 5);
  assert.ok(live.some((n) => n.kind === "stance" && n.text === "warming up"));
});

test("garbage leaves notebook and mark untouched", async () => {
  const s = setup(8);
  assert.equal(await foldOnce(s.id, deps(s, say("lol"))), "failed");
  assert.equal(s.store.foldState(s.id)!.folded, 0);
  assert.deepEqual(s.notes.live(), []);
});

test("a new turn aborts the pass without advancing", async () => {
  const s = setup(8);
  let turn = 0;
  const loud = async function* () { yield '{"add":'; turn++; yield '[{"kind":"fact","text":"x"}]}'; };
  assert.equal(await foldOnce(s.id, deps(s, loud, () => turn)), "aborted");
  assert.equal(s.store.foldState(s.id)!.folded, 0);
  assert.deepEqual(s.notes.live(), []);
  assert.equal(await foldOnce(s.id, deps(s, say('{}'), () => turn)), "done");
  assert.equal(s.store.foldState(s.id)!.folded, 6);
});

test("nothing settled is idle", async () => {
  const s = setup(2);
  let called = false;
  assert.equal(await foldOnce(s.id, deps(s, () => { called = true; return say("{}")(); })), "idle");
  assert.equal(called, false);
});

test("bumpTurn increments the shared counter", () => { const a = currentTurn(); bumpTurn(); assert.equal(currentTurn(), a + 1); });

test("3 consecutive failures skip the batch; done resets the count", async () => {
  const { noteFold, FOLD_BATCH } = await import("./fold");
  const s = setup(8); // settled 6
  assert.equal(noteFold(s.id, "failed", s.store), false);
  assert.equal(noteFold(s.id, "failed", s.store), false);
  noteFold(s.id, "done", s.store);
  assert.equal(noteFold(s.id, "failed", s.store), false);
  assert.equal(noteFold(s.id, "failed", s.store), false);
  assert.equal(s.store.foldState(s.id)!.folded, 0);
  assert.equal(noteFold(s.id, "failed", s.store), true);
  assert.equal(s.store.foldState(s.id)!.folded, Math.min(6, FOLD_BATCH));
});

test("an early t0 snapshot aborts the pass", async () => {
  const s = setup(8);
  assert.equal(await foldOnce(s.id, { ...deps(s, say("{}"), () => 5), t0: 4 }), "aborted");
});
