import type Database from "better-sqlite3";
import type { PersonaId } from "./persona";

export type StoredMsg = { role: "user" | "assistant"; content: string; image?: string | null };
export type ThreadMode = "copilot" | "companion";
export type Thread = { id: number; title: string; persona: PersonaId; updated_at: number; mode: ThreadMode; parent_id: number | null; parent_at: number | null };

const has = (db: Database.Database, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

/** Threads table + thread_id/image columns; existing single-history messages become the "General" thread. Idempotent. */
export function migrateChat(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, persona TEXT NOT NULL DEFAULT 'miyabi',
    mods TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  for (const [col, type] of [["thread_id", "INTEGER"], ["image", "TEXT"]] as const) {
    if (!has(db, "chat_messages", col)) {
      try { db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col} ${type}`); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
    }
  }
  for (const [col, type] of [["mode", "TEXT NOT NULL DEFAULT 'copilot'"], ["parent_id", "INTEGER"], ["parent_at", "INTEGER"], ["folded", "INTEGER NOT NULL DEFAULT 0"], ["settled_min", "INTEGER NOT NULL DEFAULT 0"]] as const) {
    if (!has(db, "chat_threads", col)) {
      try { db.exec(`ALTER TABLE chat_threads ADD COLUMN ${col} ${type}`); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
    }
  }
  const orphans = (db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id IS NULL").get() as { n: number }).n;
  if (orphans) {
    const now = Date.now();
    const id = Number(db.prepare("INSERT INTO chat_threads (title, persona, created_at, updated_at) VALUES ('General', 'miyabi', ?, ?)").run(now, now).lastInsertRowid);
    db.prepare("UPDATE chat_messages SET thread_id = ? WHERE thread_id IS NULL").run(id);
  }
  // Plan 20: Miyabi is the only co-pilot; old neutral/bratty/writer/tagnerd threads become hers (aru stays). Idempotent.
  db.exec("UPDATE chat_threads SET persona = 'miyabi' WHERE persona NOT IN ('miyabi', 'aru')");
}

/** "Make a gothic maid arc with…" — first user words, cut at a word boundary. */
function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 40) return t || "New chat";
  const cut = t.slice(0, 40);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 40).trim()}…`;
}

export class ThreadStore {
  constructor(private db: Database.Database) {}

  list(): Thread[] {
    return this.db.prepare(
      `SELECT t.id, t.title, t.persona, t.updated_at, t.mode, p.id AS parent_id, CASE WHEN p.id IS NULL THEN NULL ELSE t.parent_at END AS parent_at
       FROM chat_threads t LEFT JOIN chat_threads p ON p.id = t.parent_id ORDER BY t.updated_at DESC`).all() as Thread[];
  }

  create(title: string, persona: PersonaId, mode: ThreadMode = "copilot"): number {
    const now = Date.now();
    return Number(this.db.prepare("INSERT INTO chat_threads (title, persona, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(title, persona, mode, now, now).lastInsertRowid);
  }

  /** A new companion thread holding messages 0..at of `from`; that prefix is the parent's to fold, and the parent's tail settles. */
  branch(from: number, at: number): number | null {
    return this.db.transaction(() => {
      const p = this.db.prepare("SELECT title, persona, mode FROM chat_threads WHERE id = ?").get(from) as { title: string; persona: PersonaId; mode: ThreadMode } | undefined;
      const msgs = this.messages(from);
      if (!p || p.mode !== "companion" || !Number.isInteger(at) || at < 0 || at >= msgs.length) return null;
      const now = Date.now();
      const id = Number(this.db.prepare("INSERT INTO chat_threads (title, persona, mode, parent_id, parent_at, folded, settled_min, created_at, updated_at) VALUES (?, ?, 'companion', ?, ?, ?, ?, ?, ?)")
        .run(`↳ ${p.title}`.slice(0, 80), p.persona, from, at, at + 1, at + 1, now, now).lastInsertRowid);
      const ins = this.db.prepare("INSERT INTO chat_messages (created_at, role, content, thread_id, image) VALUES (?, ?, ?, ?, ?)");
      msgs.slice(0, at + 1).forEach((m) => ins.run(now, m.role, m.content, id, m.image ?? null));
      this.db.prepare("UPDATE chat_threads SET settled_min = MAX(settled_min, ?) WHERE id = ?").run(msgs.length, from);
      return id;
    })();
  }

  /** folded = messages the notebook has absorbed; settled = messages old enough to absorb (the final pair waits until the owner moves on). */
  foldState(id: number): { folded: number; settled: number } | null {
    const t = this.db.prepare("SELECT folded, settled_min FROM chat_threads WHERE id = ?").get(id) as { folded: number; settled_min: number } | undefined;
    if (!t) return null;
    const len = this.messages(id).length;
    return { folded: t.folded, settled: Math.min(len, Math.max(len - 2, t.settled_min)) };
  }

  setFolded(id: number, n: number): void {
    this.db.prepare("UPDATE chat_threads SET folded = ? WHERE id = ?").run(n, id);
  }

  /** Companion threads with something left to fold, oldest first. */
  companionThreads(): number[] {
    return (this.db.prepare("SELECT id FROM chat_threads WHERE mode = 'companion' ORDER BY updated_at").all() as { id: number }[])
      .filter((r) => { const f = this.foldState(r.id)!; return f.folded < f.settled; }).map((r) => r.id);
  }

  update(id: number, patch: { title?: string; persona?: PersonaId }): void {
    if (patch.title !== undefined) this.db.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(patch.title.slice(0, 80) || "Untitled", id);
    if (patch.persona !== undefined) this.db.prepare("UPDATE chat_threads SET persona = ? WHERE id = ?").run(patch.persona, id);
  }

  messages(id: number): StoredMsg[] {
    return this.db.prepare("SELECT role, content, image FROM chat_messages WHERE thread_id = ? ORDER BY id").all(id) as StoredMsg[];
  }

  /** updated_at — the thread's version, for "did another device write since you loaded it?". */
  version(id: number): number | null {
    return (this.db.prepare("SELECT updated_at FROM chat_threads WHERE id = ?").get(id) as { updated_at: number } | undefined)?.updated_at ?? null;
  }

  /**
   * The client's list is the truth for a thread (edits and regenerate rewrite history): store exactly it.
   * Refused (false) if the thread is gone, or — when `expect` is given — another write happened since that version.
   */
  replace(id: number, msgs: StoredMsg[], expect?: number): boolean {
    const now = Math.max(Date.now(), (this.version(id) ?? 0) + 1); // strictly increasing, even within one ms
    const ins = this.db.prepare("INSERT INTO chat_messages (created_at, role, content, thread_id, image) VALUES (?, ?, ?, ?, ?)");
    return this.db.transaction(() => {
      const v = this.version(id);
      if (v === null || (expect !== undefined && v !== expect)) return false;
      const old = this.messages(id);
      let common = 0; // the fold mark can't outlive an edit: clamp it to the shared prefix
      while (common < old.length && common < msgs.length && old[common].role === msgs[common].role && old[common].content === msgs[common].content) common++;
      this.db.prepare("UPDATE chat_threads SET folded = MIN(folded, ?), settled_min = MIN(settled_min, ?) WHERE id = ?").run(common, common, id);
      this.db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(id);
      msgs.forEach((m) => ins.run(now, m.role, m.content, id, m.image ?? null));
      const t = this.db.prepare("SELECT title FROM chat_threads WHERE id = ?").get(id) as { title: string } | undefined;
      const first = msgs.find((m) => m.role === "user");
      if (t?.title === "New chat" && first) this.db.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(titleFrom(first.content), id);
      this.db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, id);
      return true;
    })();
  }

  /** Of these image files, the ones no message refers to (safe to delete). */
  unreferenced(files: string[]): string[] {
    const used = new Set((this.db.prepare("SELECT image FROM chat_messages WHERE image IS NOT NULL").all() as { image: string }[]).map((r) => r.image));
    return files.filter((f) => !used.has(f));
  }

  /** Delete a thread and its messages; returns its image files that no other thread still uses. */
  remove(id: number): string[] {
    const images = (this.db.prepare("SELECT image FROM chat_messages WHERE thread_id = ? AND image IS NOT NULL").all(id) as { image: string }[]).map((r) => r.image);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(id);
      this.db.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
    })();
    return this.unreferenced(images);
  }
}
