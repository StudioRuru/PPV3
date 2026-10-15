import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { DEFAULT_RP_SETTINGS } from "./types";

export type MigrationCounts = {
  lorebooks: number; entries: number; personas: number; characters: number; voiceLines: number;
  chats: number; messages: number; skippedDeleted: number; images: number; files: number; missingFiles: number;
};
export type MigrationOpts = { apply: boolean; installed: string[]; failAfter?: string };

type Row = Record<string, unknown>;
const cols = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const SAFE = /^[\w-]+\.(png|jpe?g|webp)$/i;

/**
 * One-time import of Delfino Plaza's DB into the rp_* tables. `src` is opened read-only by the caller.
 * Dry run (default) only counts. Apply: copies files first (hash-checked), inserts everything in one transaction
 * (ids remapped), then archives the source DB. Any failure rolls the rows back and removes the files it copied.
 */
export async function runMigration(src: Database.Database, dst: Database.Database, files: { srcDir: string; rpDir: string }, opts: MigrationOpts) {
  if (dst.prepare("SELECT 1 FROM rp_meta WHERE key = 'migrated_from'").get()) throw new Error("Already migrated from Delfino — refusing to import twice.");

  const all = (t: string, where = "") => src.prepare(`SELECT * FROM ${t} ${where} ORDER BY id`).all() as Row[];
  const lorebooks = all("lorebooks"), entries = all("lorebook_entries"), personas = all("personas"), characters = all("characters");
  const voiceLines = all("voice_lines"), chats = all("chats"), images = all("generated_images");
  const messages = all("messages", "WHERE deleted_at IS NULL");
  const skippedDeleted = (src.prepare("SELECT COUNT(*) n FROM messages WHERE deleted_at IS NOT NULL").get() as { n: number }).n;

  // Files to bring: avatars (characters + personas) and images, by bare name.
  const wanted: { kind: "avatars" | "images"; name: string }[] = [
    ...[...characters, ...personas].map((r) => r.avatar_path).filter((n): n is string => typeof n === "string" && SAFE.test(n)).map((name) => ({ kind: "avatars" as const, name })),
    ...images.map((r) => r.path).filter((n): n is string => typeof n === "string" && SAFE.test(n)).map((name) => ({ kind: "images" as const, name })),
  ];
  const present = wanted.filter((w) => fs.existsSync(path.join(files.srcDir, w.kind, w.name)));
  const counts: MigrationCounts = {
    lorebooks: lorebooks.length, entries: entries.length, personas: personas.length, characters: characters.length,
    voiceLines: voiceLines.length, chats: chats.length, messages: messages.length, skippedDeleted,
    images: images.length, files: present.length, missingFiles: wanted.length - present.length,
  };
  if (!opts.apply) return { applied: false, counts };

  // 1. Files (before the transaction, so the rows never point at files that aren't there).
  const created: string[] = [];
  try {
    for (const w of present) {
      const from = path.join(files.srcDir, w.kind, w.name), to = path.join(files.rpDir, w.kind, w.name);
      if (fs.existsSync(to)) { if (sha(to) === sha(from)) continue; throw new Error(`${w.kind}/${w.name} already exists with different content`); }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      created.push(to);
      if (sha(to) !== sha(from)) throw new Error(`Copy of ${w.kind}/${w.name} doesn't match the original`);
    }

    // 2. Rows, in one transaction, copying every column both sides have.
    dst.transaction(() => {
      const maps = { lorebooks: new Map<unknown, number>(), personas: new Map<unknown, number>(), characters: new Map<unknown, number>(), chats: new Map<unknown, number>(), messages: new Map<unknown, number>() };
      const copy = (srcTable: string, dstTable: string, rows: Row[], fix: (r: Row) => Row, map?: Map<unknown, number>) => {
        const shared = cols(src, srcTable).filter((c) => c !== "id" && cols(dst, dstTable).includes(c));
        for (const r of rows) {
          const v = fix(Object.fromEntries(shared.map((c) => [c, r[c]])));
          const keys = Object.keys(v);
          const id = Number(dst.prepare(`INSERT INTO ${dstTable} (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(v).lastInsertRowid);
          map?.set(r.id, id);
        }
        if (opts.failAfter === srcTable) throw new Error("injected failure");
      };
      const lb = (v: unknown) => (v == null ? null : maps.lorebooks.get(v) ?? null);
      // Untagged names mean :latest to Ollama; a model that isn't installed any more → null (the heavy tier).
      const model = (v: unknown) => { if (typeof v !== "string" || !v) return null; const t = v.includes(":") ? v : `${v}:latest`; return opts.installed.includes(t) ? t : null; };

      copy("lorebooks", "rp_lorebooks", lorebooks, (r) => r, maps.lorebooks);
      copy("lorebook_entries", "rp_lore_entries", entries.filter((e) => maps.lorebooks.has(e.lorebook_id)), (r) => ({ ...r, lorebook_id: lb(r.lorebook_id) }));
      copy("personas", "rp_personas", personas, (r) => r, maps.personas);
      copy("characters", "rp_characters", characters, (r) => ({ ...r, lorebook_id: lb(r.lorebook_id), world_lorebook_id: lb(r.world_lorebook_id), model: model(r.model) }), maps.characters);
      copy("voice_lines", "rp_voice_lines", voiceLines.filter((v) => maps.characters.has(v.character_id)), (r) => ({ ...r, character_id: maps.characters.get(r.character_id) }));
      copy("chats", "rp_chats", chats, (r) => ({
        ...r, character_id: r.character_id == null ? null : maps.characters.get(r.character_id) ?? null,
        persona_id: r.persona_id == null ? null : maps.personas.get(r.persona_id) ?? null, lorebook_id: lb(r.lorebook_id), model: model(r.model),
      }), maps.chats);
      copy("messages", "rp_messages", messages.filter((m) => maps.chats.has(m.chat_id)), (r) => ({ ...r, chat_id: maps.chats.get(r.chat_id) }), maps.messages);
      // Memory high-water marks point at message ids: move them to the new id of the last kept message at or before the mark.
      for (const c of chats) {
        const mark = Number(c.summarized_through) || 0;
        const kept = messages.filter((m) => m.chat_id === c.id && Number(m.id) <= mark).at(-1);
        dst.prepare("UPDATE rp_chats SET summarized_through = ? WHERE id = ?").run(kept ? maps.messages.get(kept.id) ?? 0 : 0, maps.chats.get(c.id));
      }
      const imgCols = cols(src, "generated_images");
      for (const i of images) {
        dst.prepare("INSERT INTO rp_images (chat_id, message_id, prompt, seed, file, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          maps.chats.get(i.chat_id) ?? null, i.message_id == null ? null : maps.messages.get(i.message_id) ?? null,
          imgCols.includes("prompt") ? i.prompt ?? "" : "", Number(i.seed) || 0, String(i.path), Number(i.width) || 0, Number(i.height) || 0, Number(i.created_at) || Date.now());
      }
      if (opts.failAfter === "images") throw new Error("injected failure");

      // Global RP settings: only the fields RP uses (never keys, passwords or image settings).
      const s = src.prepare("SELECT * FROM settings WHERE id = 1").get() as Row | undefined;
      if (s) {
        const camel = (k: string): string => k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
        const picked = Object.fromEntries(Object.entries(s).map(([k, v]): [string, unknown] => [camel(k), v]).filter(([k, v]) => k in DEFAULT_RP_SETTINGS && typeof v === typeof DEFAULT_RP_SETTINGS[k as keyof typeof DEFAULT_RP_SETTINGS]));
        if (!picked.embedModel) delete picked.embedModel;
        dst.prepare("INSERT INTO settings (key, value) VALUES ('rp:settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...DEFAULT_RP_SETTINGS, ...picked }));
      }
      dst.prepare("INSERT INTO rp_meta (key, value) VALUES ('migrated_from', ?)").run(JSON.stringify({ at: Date.now(), counts }));
    })();
  } catch (e) {
    for (const f of created) fs.rmSync(f, { force: true });
    throw e;
  }

  // 3. Keep the whole source DB (poses, image settings…) for anything without a new home.
  fs.mkdirSync(files.rpDir, { recursive: true });
  await src.backup(path.join(files.rpDir, "delfino-archive.db"));
  return { applied: true, counts };
}
