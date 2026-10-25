import { NextRequest, NextResponse } from "next/server";
import { loraGate } from "../../gate";
import { cutQueue } from "@/lib/sprites/cutout";
import { decide, generate } from "@/lib/sprites/service";
import { spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => null)) as { op?: string; n?: unknown; takeId?: unknown; on?: unknown } | null;
  if (!b) return bad("Bad JSON");
  const db = spritesDb();
  if (!Number.isInteger(id) || !db.prepare("SELECT 1 FROM sprite_cells WHERE id = ?").get(id)) return bad("No such cell.", 404);
  try {
    if (b.op === "generate") {
      const n = b.n == null ? 3 : Number(b.n);
      if (!Number.isInteger(n) || n < 1 || n > 8) return bad("n must be 1-8.");
      const g = await loraGate();
      if (g) return g;
      return NextResponse.json({ jobs: generate(db, id, n) });
    }
    if (b.op === "approve") {
      const t = Number(b.takeId);
      if (!db.prepare("SELECT 1 FROM sprite_takes WHERE id = ? AND cell_id = ? AND item_id IS NOT NULL").get(t, id)) return bad("That take isn't ready.");
      decide(db, id, { approve: t });
      cutQueue();
    } else if (b.op === "reject") decide(db, id, { reject: true });
    else if (b.op === "own") decide(db, id, { own: !!b.on });
    else return bad("Unknown op.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Failed.");
  }
}
