import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateChat, ThreadStore } from "./threads";

const mem = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)");
  return db;
};

test("migration puts existing history into a 'General' thread, once", () => {
  const db = mem();
  db.prepare("INSERT INTO chat_messages (created_at, role, content) VALUES (1, 'user', 'hi'), (2, 'assistant', 'yo')").run();
  migrateChat(db); migrateChat(db);
  const s = new ThreadStore(db);
  const [t] = s.list();
  assert.equal(t.title, "General");
  assert.equal(t.persona, "miyabi");
  assert.deepEqual(s.messages(t.id).map((m) => m.content), ["hi", "yo"]);
});

test("replace() stores exactly the client's list (edits/regenerate never duplicate or lose)", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("Scene ideas", "aru");
  s.replace(id, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  s.replace(id, [{ role: "user", content: "a (edited)" }, { role: "assistant", content: "c" }]);
  assert.deepEqual(s.messages(id).map((m) => m.content), ["a (edited)", "c"]);
  assert.equal(s.list().find((t) => t.id === id)!.persona, "aru");
});

test("auto-title from the first user message; delete removes messages; images listed for cleanup", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("New chat", "miyabi");
  s.replace(id, [{ role: "user", content: "Make a gothic maid arc with a shattered armor finale please", image: "a.jpg" }]);
  assert.equal(s.list().find((t) => t.id === id)!.title, "Make a gothic maid arc with a shattered…");
  assert.deepEqual(s.remove(id), ["a.jpg"]);
  assert.equal(s.messages(id).length, 0);
});

test("review: replace refuses a deleted thread and a stale version (another device wrote meanwhile)", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("A", "miyabi");
  const v = s.version(id)!;
  assert.equal(s.replace(id, [{ role: "user", content: "phone" }], v), true);
  assert.equal(s.replace(id, [{ role: "user", content: "mac, stale" }], v), false, "version moved on");
  assert.deepEqual(s.messages(id).map((m) => m.content), ["phone"]);
  s.remove(id);
  assert.equal(s.replace(id, [{ role: "user", content: "late reply" }]), false);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM chat_messages").get() as { n: number }).n, 0, "no orphan rows");
});

test("review: unreferencedImages lists files no message points at", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("A", "miyabi");
  s.replace(id, [{ role: "user", content: "x", image: "keep.jpg" }]);
  assert.deepEqual(s.unreferenced(["keep.jpg", "orphan.jpg"]), ["orphan.jpg"]);
});

test("plan 20: old personas become miyabi, aru stays, messages untouched, second run is a no-op", () => {
  const db = mem(); migrateChat(db);
  const ins = db.prepare("INSERT INTO chat_threads (title, persona, mods, created_at, updated_at) VALUES (?, ?, '{\"tease\":true}', 1, 1)");
  const ids = Object.fromEntries(["neutral", "bratty", "writer", "tagnerd", "miyabi", "aru"].map((p) => [p, Number(ins.run(p, p).lastInsertRowid)]));
  const s = new ThreadStore(db);
  for (const id of Object.values(ids)) s.replace(id, [{ role: "user", content: `m${id}` }, { role: "assistant", content: "r" }]);
  const snap = () => JSON.stringify([db.prepare("SELECT id, title, persona, mods, updated_at FROM chat_threads ORDER BY id").all(), db.prepare("SELECT * FROM chat_messages ORDER BY id").all()]);
  const before = (db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n;
  migrateChat(db);
  const p = Object.fromEntries(s.list().map((t) => [t.title, t.persona]));
  assert.deepEqual(p, { neutral: "miyabi", bratty: "miyabi", writer: "miyabi", tagnerd: "miyabi", miyabi: "miyabi", aru: "aru" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n, before);
  assert.deepEqual(s.messages(ids.bratty).map((m) => m.content), [`m${ids.bratty}`, "r"]);
  const after = snap();
  migrateChat(db);
  assert.equal(snap(), after);
});
