import { NextRequest, NextResponse } from "next/server";
import { loraGate } from "../gate";
import { readItem } from "@/lib/comfy/store";
import { deriveBase, setBase } from "@/lib/sprites/service";
import { listOutfits, spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const surf = (s: unknown) => (s === "chat" || s === "stage" ? s : null);

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { surface?: unknown; outfit?: unknown; itemId?: unknown; derive?: { surface?: unknown; outfit?: unknown; prompt?: unknown } } | null;
  const surface = surf(b?.surface);
  if (!b || !surface || typeof b.outfit !== "string") return bad("Need a surface and an outfit.");
  const db = spritesDb();
  const outfits = listOutfits(db).map((o) => o.key);
  if (!outfits.includes(b.outfit)) return bad("Unknown outfit.");
  try {
    if (b.itemId != null) {
      if (!readItem(db, Number(b.itemId))) return bad("No such Library item.", 404);
      setBase(db, surface, b.outfit, Number(b.itemId));
      return NextResponse.json({ ok: true });
    }
    const d = b.derive, from = surf(d?.surface);
    if (!d || !from || typeof d.outfit !== "string" || !outfits.includes(d.outfit) || typeof d.prompt !== "string" || !d.prompt.trim()) return bad("Need itemId, or derive { surface, outfit, prompt }.");
    const g = await loraGate();
    if (g) return g;
    return NextResponse.json({ jobs: deriveBase(db, surface, b.outfit, from, d.outfit, d.prompt.trim()) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Failed.");
  }
}
