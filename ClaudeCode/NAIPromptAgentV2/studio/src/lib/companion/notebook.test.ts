import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateNotebook, Notebook, NOTE_CAP } from "./notebook";

const mk = () => { const db = new Database(":memory:"); migrateNotebook(db); migrateNotebook(db); return new Notebook(db); };
const from = { thread: 1, at: 1 };
const fact = (text: string) => ({ kind: "fact" as const, text });

test("apply adds, updates, removes and keeps one stance", () => {
  const nb = mk();
  nb.apply({ add: [fact("likes tea"), fact("works nights")] }, from);
  const [a, b] = [nb.live().find((n) => n.text === "likes tea")!, nb.live().find((n) => n.text === "works nights")!];
  nb.apply({ update: [{ id: a.id, text: "likes green tea" }], remove: [b.id], stance: "we are close" }, from);
  nb.apply({ stance: "we are closer" }, from);
  const live = nb.live();
  assert.equal(live.length, 2);
  assert.equal(live.filter((n) => n.kind === "fact")[0].text, "likes green tea");
  assert.deepEqual(live.filter((n) => n.kind === "stance").map((n) => n.text), ["we are closer"]);
  assert.deepEqual(nb.tombstones(), []);
});

test("pinned entries refuse model updates and removes", () => {
  const nb = mk();
  nb.apply({ add: [fact("likes rain")] }, from);
  const n = nb.live()[0].id;
  assert.equal(nb.ownerEdit(n, "loves rain"), true);
  nb.apply({ update: [{ id: n, text: "hates rain" }], remove: [n] }, from);
  assert.deepEqual(nb.live().map((x) => [x.text, x.pinned]), [["loves rain", true]]);
});

test("tombstoned text is never re-added", () => {
  const nb = mk();
  nb.apply({ add: [fact("has a cat named Mochi")] }, from);
  assert.equal(nb.ownerDelete(nb.live()[0].id), true);
  nb.apply({ add: [fact("Has a cat  named mochi")] }, from);
  assert.deepEqual(nb.live(), []);
  assert.deepEqual(nb.tombstones(), ["has a cat named Mochi"]);
});

test("cap drops the oldest unpinned notes", () => {
  const nb = mk();
  for (let i = 0; i < NOTE_CAP + 5; i++) nb.apply({ add: [fact(`fact ${i}`)] }, from);
  // all 125 added then capped as we go; pin the oldest survivor and add more
  const first = nb.live().at(-1)!;
  nb.ownerEdit(first.id, first.text);
  for (let i = 0; i < 5; i++) nb.apply({ add: [fact(`more ${i}`)] }, from);
  const notes = nb.live().filter((n) => n.kind !== "stance");
  assert.equal(notes.length, NOTE_CAP);
  assert.ok(notes.some((n) => n.id === first.id && n.pinned));
});

test("new notes carry their provenance", () => {
  const nb = mk();
  nb.apply({ add: [{ kind: "moment", text: "we watched the rain" }] }, { thread: 7, at: 11 });
  const n = nb.live()[0];
  assert.equal(n.thread_id, 7);
  assert.equal(n.msg_index, 11);
});
