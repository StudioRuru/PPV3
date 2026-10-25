import { NextRequest, NextResponse } from "next/server";
import { loraGate } from "../gate";
import { bulkCancel, bulkEstimate, bulkStart } from "@/lib/sprites/service";
import { listKeys, listOutfits, spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { surface?: unknown; outfit?: unknown; scope?: unknown; confirm?: unknown; key?: unknown; cancel?: unknown } | null;
  if (!b || (b.surface !== "chat" && b.surface !== "stage") || typeof b.outfit !== "string") return bad("Need a surface and an outfit.");
  const db = spritesDb();
  if (!listOutfits(db).some((o) => o.key === b.outfit)) return bad("Unknown outfit.");
  try {
    if (b.cancel === true) return NextResponse.json({ cancelled: bulkCancel(db, b.surface, b.outfit) });
    if (b.scope !== "basic" && b.scope !== "all") return bad("scope must be basic or all.");
    let only: string | undefined;
    if (b.key !== undefined) {
      if (b.surface !== "stage" || typeof b.key !== "string" || !listKeys(db, "stage").some((k) => k.key === b.key)) return bad("Unknown pose.");
      only = b.key;
    }
    const est = bulkEstimate(db, b.surface, b.outfit, b.scope, 3, undefined, only);
    if (b.confirm !== true) return NextResponse.json(est);
    const g = await loraGate();
    if (g) return g;
    return NextResponse.json({ ...est, started: bulkStart(db, b.surface, b.outfit, b.scope, 3, undefined, undefined, only) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Failed.");
  }
}
