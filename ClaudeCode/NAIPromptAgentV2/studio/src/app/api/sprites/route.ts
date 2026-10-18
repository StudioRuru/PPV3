import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readItem, readJob } from "@/lib/comfy/store";
import { SPRITE_LIB } from "@/lib/env";
import { type Cell, cellStatus, edges, listKeys, listOutfits, spritesDb, takes } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bytes(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const p = path.join(e.parentPath, e.name);
    if (e.isFile() && !p.includes(`${path.sep}.tmp-`)) try { n += fs.statSync(p).size; } catch { /* vanished mid-walk */ }
  }
  return n;
}

export function GET() {
  const db = spritesDb();
  const cells = (db.prepare("SELECT id FROM sprite_cells ORDER BY id").all() as { id: number }[]).map(({ id }) => {
    const c = db.prepare("SELECT * FROM sprite_cells WHERE id = ?").get(id) as { id: number; surface: Cell["surface"]; outfit: string; from_key: string; to_key: string; approved_take: number | null; rejected: number; reverse: number; cut: Cell["cut"] };
    const cell: Cell = { id: c.id, surface: c.surface, outfit: c.outfit, from: c.from_key, to: c.to_key, approvedTake: c.approved_take, rejected: !!c.rejected, reverse: !!c.reverse, cut: c.cut };
    const ts = takes(db, id);
    return {
      ...cell,
      status: cellStatus(cell, ts, (j) => readJob(db, j)?.status ?? null),
      takes: ts.map((t) => {
        const it = t.itemId == null ? null : readItem(db, t.itemId);
        return { ...t, ...(it && { file: path.basename(it.file), ...(it.poster && { poster: path.basename(it.poster) }) }) };
      }),
    };
  });
  const n = (s: string) => (db.prepare(`SELECT COUNT(*) AS n FROM comfy_jobs WHERE status = ? AND id IN (SELECT job_id FROM sprite_takes WHERE job_id IS NOT NULL)`).get(s) as { n: number }).n;
  return NextResponse.json({
    outfits: listOutfits(db), keys: [...listKeys(db, "chat"), ...listKeys(db, "stage")], edges: edges(db), cells,
    bulk: { queued: n("queued"), running: n("running") },
    libraryBytes: fs.existsSync(SPRITE_LIB) ? bytes(SPRITE_LIB) : 0,
  });
}
