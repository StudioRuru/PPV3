import type Database from "better-sqlite3";
import { resetLive, validateSlime, type SlimeDoc } from "./slime";

export type LiveState = Pick<SlimeDoc, "voice" | "selfName" | "sliders" | "heatDrift" | "look" | "memories" | "vials">;
/** Adapter over the live mascot identity; write(null) = Empty. */
export interface LiveIdentity { read(): LiveState; write(state: LiveState | null): void }
export type SlimeRow = { id: number; doc: SlimeDoc };

const ACTIVE = "active_slime";

/** Slime jars + active pointer (in mascot_meta). Idempotent. */
export function migrateSlimes(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mascot_slimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mascot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

const valid = (raw: unknown): SlimeDoc => {
  const d = validateSlime(raw);
  if (!d) throw new Error("Invalid slime doc");
  return d;
};
const pickLive = ({ voice, selfName, sliders, heatDrift, look, memories, vials }: SlimeDoc): LiveState =>
  ({ voice, selfName, sliders: resetLive(sliders), heatDrift, look, memories, vials });

export class SlimeStore {
  /** Bumped by extract/remove/insert so detached work (facts refresh) can tell the identity moved on. */
  generation = 0;
  constructor(private db: Database.Database, private live: LiveIdentity, private now: () => number = Date.now) {}

  list(): SlimeRow[] {
    return (this.db.prepare("SELECT id, doc FROM mascot_slimes ORDER BY id").all() as { id: number; doc: string }[])
      .map((r) => ({ id: r.id, doc: JSON.parse(r.doc) }));
  }
  get(id: number): SlimeDoc | null {
    const r = this.db.prepare("SELECT doc FROM mascot_slimes WHERE id = ?").get(id) as { doc: string } | undefined;
    return r ? JSON.parse(r.doc) : null;
  }
  /** Active jar id, or null when Empty. A pointer to a missing jar is cleared (and the live identity goes Empty). */
  activeId(): number | null {
    const r = this.db.prepare("SELECT value FROM mascot_meta WHERE key = ?").get(ACTIVE) as { value: string } | undefined;
    if (!r || r.value === "") return null;
    const id = Number(r.value);
    if (this.get(id)) return id;
    this.db.transaction(() => { this.setActive(null); this.live.write(null); })();
    return null;
  }
  private setActive(id: number | null): void {
    this.db.prepare("INSERT OR REPLACE INTO mascot_meta (key, value) VALUES (?, ?)").run(ACTIVE, id === null ? "" : String(id));
  }

  create(doc: SlimeDoc): number {
    const t = this.now();
    return Number(this.db.prepare("INSERT INTO mascot_slimes (doc, created_at, updated_at) VALUES (?, ?, ?)").run(JSON.stringify(valid({ ...doc, selfName: doc.selfName || doc.name })), t, t).lastInsertRowid);
  }
  save(id: number, patch: Partial<SlimeDoc>): SlimeDoc {
    const cur = this.get(id);
    if (!cur) throw new Error(`Slime ${id} not found`);
    const doc = valid({ ...cur, ...patch });
    this.db.prepare("UPDATE mascot_slimes SET doc = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(doc), this.now(), id);
    return doc;
  }
  delete(id: number): void {
    if (this.activeId() === id) throw new Error("Can't delete the active slime — remove it first");
    this.db.prepare("DELETE FROM mascot_slimes WHERE id = ?").run(id);
  }

  /** No jars yet → today's live identity becomes active jar "Miyabi". Returns the active id, or null if jars already existed without one. */
  ensureFirstRun(): number | null {
    return this.db.transaction(() => {
      if ((this.db.prepare("SELECT COUNT(*) AS n FROM mascot_slimes").get() as { n: number }).n > 0) return this.activeId();
      const id = this.create({ ...this.live.read(), name: "Miyabi", color: "#b7a4ff", origin: "miyabi" });
      this.setActive(id);
      return id;
    })();
  }

  /** Save the live identity (incl. live slider drift) as a new jar; the active jar stays active. Refused while Empty. */
  extract(name: string, color: string): number {
    const id = this.activeId();
    if (id === null) throw new Error("Nothing to extract — insert a slime first");
    this.generation++;
    return this.create({ ...this.get(id)!, ...this.live.read(), name, color });
  }

  /** Copy live state back into the active jar (memories, drift…). */
  private snapshot(): SlimeDoc | null {
    const id = this.activeId();
    return id === null ? null : this.save(id, this.live.read());
  }

  /** Snapshot the active jar, then go Empty. Returns the removed jar, or null if already Empty. */
  remove(): SlimeDoc | null {
    this.generation++;
    return this.db.transaction(() => {
      const doc = this.snapshot();
      if (!doc) return null;
      this.setActive(null);
      this.live.write(null);
      return doc;
    })();
  }

  /** Snapshot the active jar (if any), then load jar `id` with drift cleared. No-op if already active. */
  insert(id: number): void {
    this.generation++;
    this.db.transaction(() => {
      if (this.activeId() === id) return;
      const doc = this.get(id);
      if (!doc) throw new Error(`Slime ${id} not found`);
      this.snapshot();
      this.setActive(id);
      this.live.write(pickLive(doc));
    })();
  }
}
