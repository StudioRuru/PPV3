import type Database from "better-sqlite3";
import { validateVial, type Vial } from "./vial";

export type BottleRow = { id: number; vial: Vial; created_at: number };
export type RecipeRow = { id: number; name: string; vial: Vial; brewed: number; created_at: number };

/** Inventory bottles + remembered recipes (unique by case-insensitive name via `key`). Idempotent. */
export function migrateVials(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mascot_vials (id INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mascot_recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      doc TEXT NOT NULL, created_at INTEGER NOT NULL, brewed INTEGER NOT NULL DEFAULT 0)`);
}

const valid = (raw: unknown): Vial => {
  const r = validateVial(raw);
  if (!r.ok) throw new Error(`Invalid vial: ${r.reason}`);
  return r.vial;
};

export class VialStore {
  constructor(private db: Database.Database, private now: () => number = Date.now) {}

  list(): BottleRow[] {
    return (this.db.prepare("SELECT id, doc, created_at FROM mascot_vials ORDER BY id").all() as { id: number; doc: string; created_at: number }[])
      .map((r) => ({ id: r.id, vial: JSON.parse(r.doc), created_at: r.created_at }));
  }

  private insert(v: Vial): number {
    return Number(this.db.prepare("INSERT INTO mascot_vials (doc, created_at) VALUES (?, ?)").run(JSON.stringify(v), this.now()).lastInsertRowid);
  }

  /** New bottle; a new name records its recipe, a known name keeps the first definition (Forget to redefine) — brewed+1 either way. */
  bottle(raw: Vial): number {
    const v = valid(raw);
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO mascot_recipes (key, name, doc, created_at, brewed) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET brewed = brewed + 1`)
        .run(v.name.toLowerCase(), v.name, JSON.stringify(v), this.now());
      return this.insert(v);
    })();
  }

  discard(id: number): void { this.db.prepare("DELETE FROM mascot_vials WHERE id = ?").run(id); }

  /** Consume a bottle: one DELETE … RETURNING, so a double take can't both succeed. */
  take(id: number): Vial | null {
    const r = this.db.prepare("DELETE FROM mascot_vials WHERE id = ? RETURNING doc").get(id) as { doc: string } | undefined;
    return r ? JSON.parse(r.doc) : null;
  }

  recipes(): RecipeRow[] {
    return (this.db.prepare("SELECT id, name, doc, brewed, created_at FROM mascot_recipes ORDER BY name COLLATE NOCASE").all() as { id: number; name: string; doc: string; brewed: number; created_at: number }[])
      .map(({ doc, ...r }) => ({ ...r, vial: JSON.parse(doc) }));
  }

  /** `count` (1–5) new bottles from a recipe, no model call. */
  brewAgain(recipeId: number, count = 1): number[] {
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("count must be an integer from 1 to 5");
    return this.db.transaction(() => {
      const r = this.db.prepare("SELECT doc FROM mascot_recipes WHERE id = ?").get(recipeId) as { doc: string } | undefined;
      if (!r) throw new Error("Recipe not found");
      const v = valid(JSON.parse(r.doc));
      this.db.prepare("UPDATE mascot_recipes SET brewed = brewed + ? WHERE id = ?").run(count, recipeId);
      return Array.from({ length: count }, () => this.insert(v));
    })();
  }

  forgetRecipe(id: number): void { this.db.prepare("DELETE FROM mascot_recipes WHERE id = ?").run(id); }
}
