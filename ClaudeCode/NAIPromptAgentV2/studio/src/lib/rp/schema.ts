import type Database from "better-sqlite3";

// RP tables mirror Delfino Plaza's columns 1:1 (snake_case), so migration is lossless and its prompt code ports as-is.
const TS = "created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)";

const SQL = `
CREATE TABLE IF NOT EXISTS rp_lorebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', ${TS});
CREATE TABLE IF NOT EXISTS rp_lore_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lorebook_id INTEGER NOT NULL REFERENCES rp_lorebooks(id) ON DELETE CASCADE,
  keys TEXT NOT NULL DEFAULT '[]', secondary_keys TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, constant INTEGER NOT NULL DEFAULT 0, insertion_order INTEGER NOT NULL DEFAULT 0,
  scan_depth INTEGER NOT NULL DEFAULT 0, position TEXT NOT NULL DEFAULT 'after', probability INTEGER NOT NULL DEFAULT 100, ${TS});
CREATE TABLE IF NOT EXISTS rp_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, avatar_path TEXT,
  description TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '', scenario TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '', example_dialogue TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '',
  post_history_instructions TEXT NOT NULL DEFAULT '', alternate_greetings TEXT NOT NULL DEFAULT '[]',
  creator_notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  lorebook_id INTEGER REFERENCES rp_lorebooks(id) ON DELETE SET NULL, world_lorebook_id INTEGER REFERENCES rp_lorebooks(id) ON DELETE SET NULL,
  model TEXT, sampler_overrides TEXT, appearance_prompt TEXT NOT NULL DEFAULT '', outfit_prompt TEXT NOT NULL DEFAULT '',
  body_props TEXT NOT NULL DEFAULT '', agency INTEGER, pov_mode TEXT NOT NULL DEFAULT '', tense TEXT NOT NULL DEFAULT '',
  dialogue_style TEXT NOT NULL DEFAULT '', state_schema TEXT NOT NULL DEFAULT '[]', ${TS});
CREATE TABLE IF NOT EXISTS rp_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0, relationship TEXT NOT NULL DEFAULT '', address_as TEXT NOT NULL DEFAULT '',
  boundaries TEXT NOT NULL DEFAULT '', ${TS});
CREATE TABLE IF NOT EXISTS rp_voice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER NOT NULL REFERENCES rp_characters(id) ON DELETE CASCADE,
  text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', embedding BLOB,
  embed_model TEXT NOT NULL DEFAULT '', ${TS});
CREATE TABLE IF NOT EXISTS rp_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER REFERENCES rp_characters(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES rp_personas(id) ON DELETE SET NULL, title TEXT NOT NULL DEFAULT 'New chat', model TEXT,
  lorebook_id INTEGER REFERENCES rp_lorebooks(id) ON DELETE SET NULL, show_background INTEGER NOT NULL DEFAULT 1,
  author_note TEXT NOT NULL DEFAULT '', author_note_depth INTEGER NOT NULL DEFAULT 4, wallpaper_path TEXT,
  reply_length INTEGER, reply_spice INTEGER, reply_agency INTEGER, memory_summary TEXT NOT NULL DEFAULT '',
  summarized_through INTEGER NOT NULL DEFAULT 0, mods TEXT NOT NULL DEFAULT '', state_values TEXT NOT NULL DEFAULT '{}', style TEXT NOT NULL DEFAULT '', ${TS});
CREATE TABLE IF NOT EXISTS rp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES rp_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', swipes TEXT NOT NULL DEFAULT '[]',
  active_swipe_index INTEGER NOT NULL DEFAULT 0, ${TS});
CREATE TABLE IF NOT EXISTS rp_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER REFERENCES rp_chats(id) ON DELETE SET NULL,
  message_id INTEGER REFERENCES rp_messages(id) ON DELETE SET NULL, prompt TEXT NOT NULL DEFAULT '', seed INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
CREATE TABLE IF NOT EXISTS rp_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS rp_messages_chat ON rp_messages(chat_id);
`;

/** Idempotent. Also turns on foreign keys for this connection (cascades) and adds taste_events.source. */
export function migrateRp(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(SQL);
  const has = (db.prepare("PRAGMA table_info(taste_events)").all() as { name: string }[]).some((c) => c.name === "source");
  if (!has) {
    try { db.exec("ALTER TABLE taste_events ADD COLUMN source TEXT NOT NULL DEFAULT 'tag'"); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
  }
  if (!(db.prepare("PRAGMA table_info(rp_chats)").all() as { name: string }[]).some((c) => c.name === "style")) {
    db.exec("ALTER TABLE rp_chats ADD COLUMN style TEXT NOT NULL DEFAULT ''");
  }
}
