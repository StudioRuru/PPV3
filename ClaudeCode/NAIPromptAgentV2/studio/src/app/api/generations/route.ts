import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GALLERY_DIR } from "@/lib/env";
import { safeGalleryName } from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; created_at: number; model: string; seed: number; file: string; state: string; params: string; cost: number | null };

/** Newest generations, each with its file size (bytes) and Anlas cost (null = unknown). */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const rows = db.prepare("SELECT * FROM generations ORDER BY id DESC LIMIT ?").all(limit) as Row[];
  const items = await Promise.all(rows.map(async (r) => {
    const name = safeGalleryName(r.file);
    const size = name ? await fs.stat(path.join(GALLERY_DIR, name)).then((s) => s.size, () => null) : null;
    return { ...r, state: JSON.parse(r.state), params: JSON.parse(r.params), size };
  }));
  return NextResponse.json({ items });
}
