import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GALLERY_DIR } from "@/lib/env";
import { pickRows, zipName, type ExportPick } from "@/lib/export";
import { safeGalleryName } from "@/lib/gallery";
import { zipStream } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; created_at: number; file: string; seed: number; state: string; params: string };

/** The rows a request selects whose PNG is actually on disk. */
async function select(sp: URLSearchParams) {
  const pick: ExportPick = sp.get("ids") ? { ids: sp.get("ids")!.split(",").map(Number).filter(Number.isInteger) }
    : sp.get("today") ? { today: true } : { last: Number(sp.get("last")) || 0 };
  const rows = pickRows(db.prepare("SELECT id, created_at, file, seed, state, params FROM generations ORDER BY id DESC LIMIT 2000").all() as Row[], pick);
  const present = [];
  for (const r of rows) {
    const name = safeGalleryName(r.file);
    if (name && (await fs.stat(path.join(GALLERY_DIR, name)).then((st) => st.isFile(), () => false))) present.push({ ...r, file: name });
  }
  return present;
}

/**
 * GET ?today=1 | ?last=N | ?ids=1,2,3 → a zip of the full PNGs (NovelAI metadata intact) + recipes.json, streamed.
 * Add &check=1 for a pre-flight { count } (or { error }) so the sheet can show the real count and errors.
 */
export async function GET(req: NextRequest) {
  const rows = await select(req.nextUrl.searchParams);
  if (!rows.length) return NextResponse.json({ error: "No images match that choice." }, { status: 404 });
  if (req.nextUrl.searchParams.get("check")) return NextResponse.json({ count: rows.length });

  async function* entries() {
    const recipes = [];
    for (const r of rows) {
      const png = await fs.readFile(path.join(GALLERY_DIR, r.file)).catch(() => null);
      if (!png) continue;
      yield { name: r.file, data: png };
      try { recipes.push({ file: r.file, id: r.id, seed: r.seed, created_at: new Date(r.created_at).toISOString(), state: JSON.parse(r.state), params: JSON.parse(r.params) }); }
      catch { /* a corrupt recipe row still exports its image */ }
    }
    yield { name: "recipes.json", data: new TextEncoder().encode(JSON.stringify(recipes, null, 2)) };
  }
  return new Response(zipStream(entries()), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName(rows)}"` },
  });
}
