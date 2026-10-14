import "server-only";
import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "@/lib/env";

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
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL
)`);
