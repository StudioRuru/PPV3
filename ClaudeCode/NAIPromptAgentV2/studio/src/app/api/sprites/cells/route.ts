import { NextRequest, NextResponse } from "next/server";
import { cellRef } from "@/lib/sprites/cellref";
import { cell, listKeys, listOutfits, spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Gets or creates the cell for an endpoint or clip so the UI can act on it. */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const db = spritesDb();
  const r = cellRef(b, listOutfits(db).map((o) => o.key), [...listKeys(db, "chat"), ...listKeys(db, "stage")]);
  if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
  return NextResponse.json({ id: cell(db, r.surface, r.outfit, r.from, r.to).id });
}
