import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";
import { runMigration } from "./migrate";

/** A small Delfino-shaped source DB (real column names) with files on disk. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpmig-"));
  const src = new Database(path.join(dir, "delfino.db"));
  src.exec(`
    CREATE TABLE lorebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '' NOT NULL, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE lorebook_entries (id INTEGER PRIMARY KEY, lorebook_id INTEGER, keys TEXT, content TEXT, enabled INTEGER, insertion_order INTEGER, secondary_keys TEXT, constant INTEGER, scan_depth INTEGER, position TEXT, probability INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE personas (id INTEGER PRIMARY KEY, name TEXT, description TEXT, avatar_path TEXT, is_default INTEGER, relationship TEXT, address_as TEXT, boundaries TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, avatar_path TEXT, description TEXT, first_message TEXT, alternate_greetings TEXT, lorebook_id INTEGER, world_lorebook_id INTEGER, model TEXT, pov_mode TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE voice_lines (id INTEGER PRIMARY KEY, character_id INTEGER, text TEXT, context TEXT, source TEXT, embedding BLOB, embed_model TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE chats (id INTEGER PRIMARY KEY, character_id INTEGER, persona_id INTEGER, title TEXT, model TEXT, lorebook_id INTEGER, memory_summary TEXT, summarized_through INTEGER, author_note TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, swipes TEXT, active_swipe_index INTEGER, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
    CREATE TABLE generated_images (id INTEGER PRIMARY KEY, chat_id INTEGER, message_id INTEGER, provider TEXT, prompt TEXT, seed INTEGER, path TEXT, width INTEGER, height INTEGER, created_at INTEGER, updated_at INTEGER, pose_id INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, system_prompt_template TEXT, jailbreak_prompt TEXT, temperature REAL, top_p REAL, top_k INTEGER, repeat_penalty REAL, min_p REAL, num_ctx INTEGER, reply_length INTEGER, reply_spice INTEGER, reply_agency INTEGER, mods TEXT, lore_budget_pct INTEGER, embed_model TEXT, nai_api_key_enc TEXT);
    -- ids deliberately not 1-based so remapping is visible
    INSERT INTO lorebooks VALUES (7, 'World', '', 1, 1), (8, 'Cafe', '', 1, 1);
    INSERT INTO lorebook_entries VALUES (1, 8, '["cafe"]', 'Cats.', 1, 0, '[]', 0, 0, 'after', 100, 1, 1);
    INSERT INTO personas VALUES (5, 'Phil', 'me', NULL, 1, '', '', '', 1, 1);
    INSERT INTO characters VALUES (30, 'Mio', 'a.png', 'brat', 'Hi', '["Yo"]', 8, 7, 'gone:latest', 'second', 1, 1),
                                  (31, 'Ina', NULL, 'calm', 'Hey', '[]', NULL, NULL, 'cydonia-24b:latest', '', 1, 1);
    INSERT INTO voice_lines VALUES (1, 30, 'Hmph.', '', '', X'0000803F', 'bge-m3:latest', 1, 1);
    INSERT INTO chats VALUES (40, 30, 5, 'Cafe date', 'gone:latest', 8, 'They met.', 52, 'Be bratty', 1, 1), (41, 31, NULL, 'Walk', 'cydonia-24b', NULL, '', 0, '', 1, 1);
    INSERT INTO messages VALUES (50, 40, 'assistant', 'Hi', '["Hi","Yo"]', 0, 1, 1, NULL),
                                (51, 40, 'user', 'deleted', '[]', 0, 1, 1, 99),
                                (52, 40, 'assistant', 'B', '["A","B"]', 1, 1, 1, NULL),
                                (53, 41, 'user', 'walk?', '[]', 0, 1, 1, NULL);
    INSERT INTO generated_images VALUES (60, 40, 52, 'novelai', 'cafe', 1, 'i1.png', 832, 1216, 1, 1, NULL), (61, 40, 51, 'novelai', 'gone', 2, 'i2.png', 832, 1216, 1, 1, NULL);
    INSERT INTO settings VALUES (1, 'SYS', 'JB', 0.85, 0.95, 40, 1.08, 0.05, 20480, 2, 4, 2, '{}', 25, 'bge-m3:latest', 'SECRET');
  `);
  fs.mkdirSync(path.join(dir, "avatars")); fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(path.join(dir, "avatars", "a.png"), "avatar");
  fs.writeFileSync(path.join(dir, "images", "i1.png"), "img1");
  fs.writeFileSync(path.join(dir, "images", "i2.png"), "img2");
  const dst = new Database(":memory:");
  dst.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY, created_at INTEGER, kind TEXT, tags TEXT, note TEXT, persona TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  migrateRp(dst);
  dst.prepare("INSERT INTO rp_characters (name) VALUES ('Existing')").run(); // ids in Studio already taken
  const rpDir = path.join(dir, "out");
  return { dir, src, dst, rpDir, files: { srcDir: dir, rpDir } };
}
const n = (db: Database.Database, t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;

test("dry run counts everything and writes nothing", async () => {
  const f = fixture();
  const r = await runMigration(f.src, f.dst, f.files, { apply: false, installed: ["cydonia-24b:latest"] });
  assert.deepEqual({ ...r.counts }, { lorebooks: 2, entries: 1, personas: 1, characters: 2, voiceLines: 1, chats: 2, messages: 3, skippedDeleted: 1, images: 2, files: 3, missingFiles: 0 });
  assert.equal(n(f.dst, "rp_chats"), 0);
  assert.equal(fs.existsSync(f.rpDir), false);
});

test("apply: counts match, ids remapped, swipes intact, deleted skipped, models filtered, settings copied without secrets", async () => {
  const f = fixture();
  const r = await runMigration(f.src, f.dst, f.files, { apply: true, installed: ["cydonia-24b:latest"] });
  assert.equal(r.applied, true);
  assert.equal(n(f.dst, "rp_characters"), 3);
  assert.equal(n(f.dst, "rp_messages"), 3);
  const mio = f.dst.prepare("SELECT * FROM rp_characters WHERE name = 'Mio'").get() as Record<string, unknown>;
  const cafe = f.dst.prepare("SELECT id FROM rp_lorebooks WHERE name = 'Cafe'").get() as { id: number };
  const world = f.dst.prepare("SELECT id FROM rp_lorebooks WHERE name = 'World'").get() as { id: number };
  assert.equal(mio.lorebook_id, cafe.id);
  assert.equal(mio.world_lorebook_id, world.id);
  assert.equal(mio.model, null); // not installed any more → heavy tier
  assert.equal(mio.pov_mode, "second");
  assert.equal((f.dst.prepare("SELECT model FROM rp_characters WHERE name = 'Ina'").get() as { model: string }).model, "cydonia-24b:latest");
  assert.equal((f.dst.prepare("SELECT model FROM rp_chats WHERE title = 'Walk'").get() as { model: string }).model, "cydonia-24b:latest"); // untagged = :latest
  const chat = f.dst.prepare("SELECT * FROM rp_chats WHERE title = 'Cafe date'").get() as Record<string, unknown>;
  assert.equal(chat.character_id, mio.id);
  assert.equal(chat.persona_id, (f.dst.prepare("SELECT id FROM rp_personas").get() as { id: number }).id);
  assert.equal(chat.lorebook_id, cafe.id);
  assert.equal(chat.author_note, "Be bratty");
  const msgs = f.dst.prepare("SELECT * FROM rp_messages WHERE chat_id = ? ORDER BY id").all(chat.id) as Record<string, unknown>[];
  assert.deepEqual(msgs.map((m) => m.content), ["Hi", "B"]);
  assert.equal(msgs[1].swipes, '["A","B"]');
  assert.equal(msgs[1].active_swipe_index, 1);
  // summarized_through pointed at Delfino message 52 → now the new id of that message
  assert.equal(chat.summarized_through, msgs[1].id);
  const imgs = f.dst.prepare("SELECT * FROM rp_images ORDER BY file").all() as Record<string, unknown>[];
  assert.equal(imgs[0].message_id, msgs[1].id);
  assert.equal(imgs[1].message_id, null); // its message was deleted in Delfino
  assert.equal((f.dst.prepare("SELECT embedding FROM rp_voice_lines").get() as { embedding: Buffer }).embedding.readFloatLE(0), 1);
  const s = JSON.parse((f.dst.prepare("SELECT value FROM settings WHERE key = 'rp:settings'").get() as { value: string }).value);
  assert.equal(s.systemPromptTemplate, "SYS");
  assert.equal(s.numCtx, 20480);
  assert.equal(JSON.stringify(s).includes("SECRET"), false);
  assert.equal(fs.readFileSync(path.join(f.rpDir, "avatars", "a.png"), "utf8"), "avatar");
  assert.equal(fs.readFileSync(path.join(f.rpDir, "images", "i2.png"), "utf8"), "img2");
  assert.ok(fs.existsSync(path.join(f.rpDir, "delfino-archive.db")));
});

test("a second run refuses", async () => {
  const f = fixture();
  await runMigration(f.src, f.dst, f.files, { apply: true, installed: [] });
  await assert.rejects(runMigration(f.src, f.dst, f.files, { apply: true, installed: [] }), /already migrated/i);
});

test("a failure mid-way leaves the destination unchanged and removes copied files", async () => {
  const f = fixture();
  await assert.rejects(runMigration(f.src, f.dst, f.files, { apply: true, installed: [], failAfter: "messages" }), /injected/);
  assert.equal(n(f.dst, "rp_characters"), 1);
  assert.equal(n(f.dst, "rp_messages"), 0);
  assert.equal(n(f.dst, "rp_meta"), 0);
  assert.equal(fs.existsSync(path.join(f.rpDir, "images", "i1.png")), false);
});

test("missing source files are counted, not fatal", async () => {
  const f = fixture();
  fs.rmSync(path.join(f.dir, "images", "i2.png"));
  const r = await runMigration(f.src, f.dst, f.files, { apply: false, installed: [] });
  assert.equal(r.counts.missingFiles, 1);
});
