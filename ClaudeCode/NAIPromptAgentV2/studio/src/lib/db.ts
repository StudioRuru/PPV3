import "server-only";
import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "@/lib/env";
import { migrateChat } from "@/lib/threads";
import { migrateRp } from "@/lib/rp/schema";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  model TEXT NOT NULL,
  seed INTEGER NOT NULL,
  file TEXT NOT NULL,
  state TEXT NOT NULL,
  params TEXT NOT NULL,
  grid_id TEXT
)`);
// Added 2026-10-14: Anlas spent per generation (null = unknown).
if (!(db.prepare("PRAGMA table_info(generations)").all() as { name: string }[]).some((c) => c.name === "cost")) {
  // Two processes can race here on first boot (dev + build workers); the loser's "duplicate column" is harmless.
  try { db.exec("ALTER TABLE generations ADD COLUMN cost INTEGER"); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
}
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export function getSetting(key: string): string | null {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}
export function setSetting(key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL
)`);
migrateChat(db);
// Taste learning (Chat 2.0): what the owner applies, likes and dislikes, plus rules they pin.
db.exec(`CREATE TABLE IF NOT EXISTS taste_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', persona TEXT NOT NULL DEFAULT 'neutral')`);
db.exec("CREATE TABLE IF NOT EXISTS pinned_prefs (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)");
migrateRp(db); // after taste_events: adds its source column
