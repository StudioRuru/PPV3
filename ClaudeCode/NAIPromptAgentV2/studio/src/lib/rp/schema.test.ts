import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";

const TABLES = ["rp_characters", "rp_personas", "rp_lorebooks", "rp_lore_entries", "rp_voice_lines", "rp_chats", "rp_messages", "rp_images", "rp_meta"];
const mem = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', persona TEXT NOT NULL DEFAULT 'neutral')");
  return db;
};
const cols = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

test("creates every rp table, and a second run changes nothing", () => {
  const db = mem();
  migrateRp(db);
  const before = TABLES.map((t) => cols(db, t));
  for (const [i, t] of TABLES.entries()) assert.ok(before[i].length > 1, `${t} exists`);
  migrateRp(db);
  assert.deepEqual(TABLES.map((t) => cols(db, t)), before);
});

test("rp_characters mirrors Delfino's columns", () => {
  const db = mem(); migrateRp(db);
  for (const c of ["first_message", "alternate_greetings", "lorebook_id", "world_lorebook_id", "pov_mode", "state_schema", "agency", "sampler_overrides"]) assert.ok(cols(db, "rp_characters").includes(c), c);
  for (const c of ["author_note_depth", "memory_summary", "summarized_through", "state_values"]) assert.ok(cols(db, "rp_chats").includes(c), c);
});

test("taste_events gains source, defaulting to 'tag' for existing rows", () => {
  const db = mem();
  db.prepare("INSERT INTO taste_events (created_at, kind) VALUES (1, 'like')").run();
  migrateRp(db);
  assert.equal((db.prepare("SELECT source FROM taste_events").get() as { source: string }).source, "tag");
});

test("deleting a chat deletes its messages", () => {
  const db = mem(); migrateRp(db);
  db.prepare("INSERT INTO rp_characters (name) VALUES ('Mio')").run();
  db.prepare("INSERT INTO rp_chats (character_id) VALUES (1)").run();
  db.prepare("INSERT INTO rp_messages (chat_id, role, content) VALUES (1, 'user', 'hi')").run();
  db.prepare("DELETE FROM rp_chats WHERE id = 1").run();
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rp_messages").get() as { n: number }).n, 0);
});
