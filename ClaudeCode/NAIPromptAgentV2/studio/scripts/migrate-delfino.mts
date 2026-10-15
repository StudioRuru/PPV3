// One-time import of Project Delfino Plaza into Studio's RP tables.
//   npx tsx scripts/migrate-delfino.mts            → dry run: prints what would be imported
//   npx tsx scripts/migrate-delfino.mts --apply    → imports (one transaction), copies files, archives delfino.db
// Options: --src <delfino data dir>  (default ~/ClaudeCode/Project Delfino Plaza/data)
//          --repo <repo dir>         (default: REPO_DIR or ..; Studio's DB is <repo>/data/studio.db)
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrateRp } from "../src/lib/rp/schema";
import { runMigration } from "../src/lib/rp/migrate";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const srcDir = arg("--src") ?? path.join(os.homedir(), "ClaudeCode/Project Delfino Plaza/data");
const repo = arg("--repo") ?? process.env.REPO_DIR ?? path.resolve(process.cwd(), "..");
const dbPath = path.join(repo, "data", "studio.db");
const ollama = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

const src = new Database(path.join(srcDir, "delfino.db"), { readonly: true, fileMustExist: true });
const dst = new Database(dbPath, { fileMustExist: true });
dst.pragma("journal_mode = WAL");
dst.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
dst.exec("CREATE TABLE IF NOT EXISTS taste_events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', persona TEXT NOT NULL DEFAULT 'neutral')");
migrateRp(dst);
const installed: string[] = await fetch(`${ollama}/api/tags`).then((r) => r.json()).then((j) => j.models.map((m: { name: string }) => m.name), () => []);

console.log(`${apply ? "Importing" : "Dry run"}: ${srcDir} → ${dbPath}`);
try {
  const r = await runMigration(src, dst, { srcDir, rpDir: path.join(repo, "data", "rp") }, { apply, installed });
  console.table(r.counts);
  console.log(r.applied ? "Done. Archive saved to data/rp/delfino-archive.db" : "Nothing written. Re-run with --apply to import.");
} catch (e) {
  console.error(`Not imported: ${(e as Error).message}`);
  process.exitCode = 1;
}
