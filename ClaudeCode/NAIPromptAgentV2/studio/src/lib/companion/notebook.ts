import type Database from "better-sqlite3";

export type NoteKind = "fact" | "moment" | "stance";
export type Note = { id: number; kind: NoteKind; text: string; thread_id: number | null; msg_index: number | null; pinned: boolean; updated_at: number };
export type NoteOps = { add?: { kind: "fact" | "moment"; text: string }[]; update?: { id: number; text: string }[]; remove?: number[]; stance?: string };

export const NOTE_CAP = 120;
export const NOTE_MAX_CHARS = 280;

export function migrateNotebook(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS companion_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, thread_id INTEGER, msg_index INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
}

const clean = (s: string) => String(s ?? "").trim().slice(0, NOTE_MAX_CHARS);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export class Notebook {
  constructor(private db: Database.Database) {}

  live(): Note[] {
    const rows = this.db.prepare(
      "SELECT id, kind, text, thread_id, msg_index, pinned, updated_at FROM companion_notes WHERE deleted = 0 ORDER BY updated_at DESC, id DESC").all() as (Omit<Note, "pinned"> & { pinned: number })[];
    return rows.map((r) => ({ ...r, pinned: !!r.pinned }));
  }

  tombstones(limit = 50): string[] {
    return (this.db.prepare("SELECT text FROM companion_notes WHERE deleted = 1 ORDER BY updated_at DESC, id DESC LIMIT ?").all(limit) as { text: string }[]).map((r) => r.text);
  }

  apply(ops: NoteOps, from: { thread: number; at: number }): void {
    const db = this.db;
    db.transaction(() => {
      const now = Date.now();
      const unpinnedLive = (id: number) => !!db.prepare("SELECT 1 FROM companion_notes WHERE id = ? AND deleted = 0 AND pinned = 0 AND kind != 'stance'").get(id);
      for (const u of ops.update ?? []) {
        const text = clean(u.text);
        if (text && unpinnedLive(u.id)) db.prepare("UPDATE companion_notes SET text = ?, updated_at = ? WHERE id = ?").run(text, now, u.id);
      }
      for (const id of ops.remove ?? []) if (unpinnedLive(id)) db.prepare("DELETE FROM companion_notes WHERE id = ?").run(id);
      const seen = new Set((db.prepare("SELECT text FROM companion_notes WHERE kind != 'stance'").all() as { text: string }[]).map((r) => norm(r.text)));
      for (const a of ops.add ?? []) {
        const text = clean(a.text);
        if (!text || (a.kind !== "fact" && a.kind !== "moment") || seen.has(norm(text))) continue;
        seen.add(norm(text));
        db.prepare("INSERT INTO companion_notes (kind, text, thread_id, msg_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(a.kind, text, from.thread, from.at, now, now);
      }
      const stance = clean(ops.stance ?? "");
      if (stance) {
        const cur = db.prepare("SELECT id, pinned FROM companion_notes WHERE kind = 'stance' AND deleted = 0").get() as { id: number; pinned: number } | undefined;
        if (!cur) db.prepare("INSERT INTO companion_notes (kind, text, thread_id, msg_index, created_at, updated_at) VALUES ('stance', ?, ?, ?, ?, ?)").run(stance, from.thread, from.at, now, now);
        else if (!cur.pinned) db.prepare("UPDATE companion_notes SET text = ?, thread_id = ?, msg_index = ?, updated_at = ? WHERE id = ?").run(stance, from.thread, from.at, now, cur.id);
      }
      const over = (db.prepare("SELECT COUNT(*) AS n FROM companion_notes WHERE kind != 'stance' AND deleted = 0").get() as { n: number }).n - NOTE_CAP;
      if (over > 0) {
        db.prepare("DELETE FROM companion_notes WHERE id IN (SELECT id FROM companion_notes WHERE kind != 'stance' AND deleted = 0 AND pinned = 0 ORDER BY updated_at ASC, id ASC LIMIT ?)").run(over);
      }
    })();
  }

  ownerEdit(id: number, text: string): boolean {
    const t = clean(text);
    if (!t) return false;
    return this.db.prepare("UPDATE companion_notes SET text = ?, pinned = 1, updated_at = ? WHERE id = ? AND deleted = 0").run(t, Date.now(), id).changes > 0;
  }

  ownerDelete(id: number): boolean {
    return this.db.prepare("UPDATE companion_notes SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0").run(Date.now(), id).changes > 0;
  }
}
