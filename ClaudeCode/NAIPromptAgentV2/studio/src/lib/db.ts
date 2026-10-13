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
