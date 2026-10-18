import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import sharp from "sharp";
import { cutout } from "../mascot/sprites";
import { readItem } from "../comfy/store";
import { COMFY_DIR, FFMPEG, SPRITE_LIB } from "../env";
import { safeLibPath } from "./library";
import { spritesDb, takes } from "./store";

type Db = Database.Database;
export type CutDeps = { db: Db; dir: string; lib: string; extract: (mp4: string, outDir: string) => Promise<string[]>; cut: (png: Buffer) => Promise<Buffer | null> };

const run = promisify(execFile);
const WIDTH = { chat: 360, stage: 480 };

async function extract(mp4: string, out: string): Promise<string[]> {
  await run(FFMPEG, ["-v", "error", "-i", mp4, path.join(out, "%03d.png")]);
  return fs.readdirSync(out).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(out, f));
}

/** Cuts a cell's approved clip into <lib>/<surface>/<outfit>/<from>~<to>/NNN.webp + meta.json; a half-cut clip is never visible. */
export async function cutClip(cellId: number, d: CutDeps): Promise<void> {
  const set = (cut: string) => d.db.prepare("UPDATE sprite_cells SET cut = ? WHERE id = ?").run(cut, cellId);
  const c = d.db.prepare("SELECT surface, outfit, from_key, to_key, approved_take FROM sprite_cells WHERE id = ?").get(cellId) as
    { surface: "chat" | "stage"; outfit: string; from_key: string; to_key: string; approved_take: number | null } | undefined;
  if (!c) return;
  const final = safeLibPath(d.lib, [c.surface, c.outfit, `${c.from_key}~${c.to_key}`]);
  if (!final) { set("error"); return; }
  const work = path.join(d.lib, `.tmp-${cellId}-${Date.now()}`);
  set("cutting");
  const current = () => !!d.db.prepare("SELECT 1 FROM sprite_cells WHERE id = ? AND approved_take IS ? AND cut = 'cutting'").get(cellId, c.approved_take);
  try {
    const itemId = c.approved_take == null ? null : takes(d.db, cellId).find((t) => t.id === c.approved_take)?.itemId;
    const item = itemId == null ? null : readItem(d.db, itemId);
    if (!item) throw new Error("approved clip is gone");
    fs.mkdirSync(path.join(work, "src"), { recursive: true });
    const pngs = await d.extract(path.join(d.dir, path.basename(item.file)), path.join(work, "src"));
    if (!pngs.length) throw new Error("no frames");
    const out = path.join(work, "out");
    fs.mkdirSync(out);
    let w = 0, h = 0;
    for (const [i, p] of pngs.entries()) {
      const cut = await d.cut(fs.readFileSync(p));
      if (!cut) throw new Error(`cutout failed on frame ${i}`);
      const r = await sharp(cut).resize({ width: WIDTH[c.surface] }).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(out, `${String(i).padStart(3, "0")}.webp`));
      ({ width: w, height: h } = r);
    }
    fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ frames: pngs.length, fps: 30, w, h, v: c.approved_take }));
    // Re-approved mid-cut (approve/staleDependents reset the row): drop this output, the queue re-cuts the new take. No await from here on, so nothing interleaves.
    if (!current()) return;
    fs.mkdirSync(path.dirname(final), { recursive: true });
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(out, final);
    set("done");
  } catch (e) {
    if (!current()) return;
    console.warn(`sprites: cut of cell ${cellId} failed: ${e instanceof Error ? e.message : e}`);
    fs.rmSync(final, { recursive: true, force: true });
    set("error");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Serial drain over approved clips that still need cutting; single-flight across route bundles. */
export function cutQueue(): void {
  const g = globalThis as { __spriteCut?: boolean };
  if (g.__spriteCut) return;
  g.__spriteCut = true;
  void (async () => {
    try {
      const db = spritesDb();
      const deps: CutDeps = { db, dir: COMFY_DIR, lib: SPRITE_LIB, extract, cut: (b) => cutout(b, fetch) };
      for (;;) {
        const r = db.prepare("SELECT id FROM sprite_cells WHERE approved_take IS NOT NULL AND to_key != '' AND from_key != '@base' AND reverse = 0 AND cut IN ('none','cutting') ORDER BY id LIMIT 1").get() as { id: number } | undefined;
        if (!r) break;
        await cutClip(r.id, deps);
      }
    } catch (e) { console.warn(`sprites: cut queue stopped: ${e instanceof Error ? e.message : e}`); }
    finally { g.__spriteCut = false; }
  })();
}
