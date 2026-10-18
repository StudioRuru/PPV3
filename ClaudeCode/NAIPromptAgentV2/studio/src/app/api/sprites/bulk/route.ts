import { NextRequest, NextResponse } from "next/server";
import { bulkCancel, bulkEstimate, bulkStart } from "@/lib/sprites/service";
import { spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { surface?: unknown; outfit?: unknown; scope?: unknown; confirm?: unknown; cancel?: unknown } | null;
  if (!b || (b.surface !== "chat" && b.surface !== "stage") || typeof b.outfit !== "string") return bad("Need a surface and an outfit.");
  const db = spritesDb();
  try {
    if (b.cancel === true) return NextResponse.json({ cancelled: bulkCancel(db, b.surface, b.outfit) });
    if (b.scope !== "basic" && b.scope !== "all") return bad("scope must be basic or all.");
    const est = bulkEstimate(db, b.surface, b.outfit, b.scope);
    if (b.confirm !== true) return NextResponse.json(est);
    return NextResponse.json({ ...est, started: bulkStart(db, b.surface, b.outfit, b.scope) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Failed.");
  }
}
