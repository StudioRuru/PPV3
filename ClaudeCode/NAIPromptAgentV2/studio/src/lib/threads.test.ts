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
  assert.deepEqual(s.messages(t.id).map((m) => m.content), ["hi", "yo"]);
});

test("replace() stores exactly the client's list (edits/regenerate never duplicate or lose)", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("Scene ideas", "bratty");
  s.replace(id, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  s.replace(id, [{ role: "user", content: "a (edited)" }, { role: "assistant", content: "c" }]);
  assert.deepEqual(s.messages(id).map((m) => m.content), ["a (edited)", "c"]);
  assert.equal(s.list().find((t) => t.id === id)!.persona, "bratty");
});

test("auto-title from the first user message; delete removes messages; images listed for cleanup", () => {
  const db = mem(); migrateChat(db);
  const s = new ThreadStore(db);
  const id = s.create("New chat", "neutral");
  s.replace(id, [{ role: "user", content: "Make a gothic maid arc with a shattered armor finale please", image: "a.jpg" }]);
  assert.equal(s.list().find((t) => t.id === id)!.title, "Make a gothic maid arc with a shattered…");
  assert.deepEqual(s.remove(id), ["a.jpg"]);
  assert.equal(s.messages(id).length, 0);
});
