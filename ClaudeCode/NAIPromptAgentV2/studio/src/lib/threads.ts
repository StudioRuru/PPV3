import type Database from "better-sqlite3";
import type { Modifiers, PersonaId } from "./persona";

export type StoredMsg = { role: "user" | "assistant"; content: string; image?: string | null };
export type Thread = { id: number; title: string; persona: PersonaId; mods: Modifiers; updated_at: number };

const has = (db: Database.Database, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

/** Threads table + thread_id/image columns; existing single-history messages become the "General" thread. Idempotent. */
export function migrateChat(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, persona TEXT NOT NULL DEFAULT 'neutral',
    mods TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  for (const [col, type] of [["thread_id", "INTEGER"], ["image", "TEXT"]] as const) {
    if (!has(db, "chat_messages", col)) {
      try { db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col} ${type}`); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
    }
  }
  const orphans = (db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id IS NULL").get() as { n: number }).n;
  if (orphans) {
    const now = Date.now();
    const id = Number(db.prepare("INSERT INTO chat_threads (title, persona, created_at, updated_at) VALUES ('General', 'neutral', ?, ?)").run(now, now).lastInsertRowid);
    db.prepare("UPDATE chat_messages SET thread_id = ? WHERE thread_id IS NULL").run(id);
  }
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
    return (this.db.prepare("SELECT id, title, persona, mods, updated_at FROM chat_threads ORDER BY updated_at DESC").all() as (Omit<Thread, "mods"> & { mods: string })[])
      .map((t) => ({ ...t, mods: JSON.parse(t.mods || "{}") }));
  }

  create(title: string, persona: PersonaId): number {
    const now = Date.now();
    return Number(this.db.prepare("INSERT INTO chat_threads (title, persona, created_at, updated_at) VALUES (?, ?, ?, ?)").run(title, persona, now, now).lastInsertRowid);
  }

  update(id: number, patch: { title?: string; persona?: PersonaId; mods?: Modifiers }): void {
    if (patch.title !== undefined) this.db.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(patch.title.slice(0, 80) || "Untitled", id);
    if (patch.persona !== undefined) this.db.prepare("UPDATE chat_threads SET persona = ? WHERE id = ?").run(patch.persona, id);
    if (patch.mods !== undefined) this.db.prepare("UPDATE chat_threads SET mods = ? WHERE id = ?").run(JSON.stringify(patch.mods), id);
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
