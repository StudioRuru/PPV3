import fs from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GALLERY_DIR } from "@/lib/env";
import { pickRows, zipName, type ExportPick } from "@/lib/export";
import { safeGalleryName } from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; created_at: number; file: string; seed: number; state: string; params: string };

/** GET ?today=1 | ?last=N | ?ids=1,2,3 → one zip of the full PNGs (NovelAI metadata intact) + recipes.json. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const pick: ExportPick = sp.get("ids") ? { ids: sp.get("ids")!.split(",").map(Number).filter(Number.isInteger) }
    : sp.get("today") ? { today: true } : { last: Number(sp.get("last")) || 0 };
  const rows = pickRows(db.prepare("SELECT id, created_at, file, seed, state, params FROM generations ORDER BY id DESC LIMIT 2000").all() as Row[], pick);
  if (!rows.length) return NextResponse.json({ error: "No images match that choice." }, { status: 404 });

  const files: Zippable = {};
  const recipes = [];
  for (const r of rows) {
    const name = safeGalleryName(r.file);
    const png = name && (await fs.readFile(path.join(GALLERY_DIR, name)).catch(() => null));
    if (!png) continue;
    files[name] = [new Uint8Array(png), { level: 0 }]; // PNGs are already compressed: store
    recipes.push({ file: name, id: r.id, seed: r.seed, created_at: new Date(r.created_at).toISOString(), state: JSON.parse(r.state), params: JSON.parse(r.params) });
  }
  if (!recipes.length) return NextResponse.json({ error: "Those images are missing from the gallery folder." }, { status: 404 });
  files["recipes.json"] = new TextEncoder().encode(JSON.stringify(recipes, null, 2));
  const zip = zipSync(files);
  return new NextResponse(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName(rows)}"`, "Content-Length": String(zip.length) },
  });
}
