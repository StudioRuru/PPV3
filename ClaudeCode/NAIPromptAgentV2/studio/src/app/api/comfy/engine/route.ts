import { NextResponse } from "next/server";
import { getEngine, Refused } from "@/lib/comfy/engine";
import type { Card } from "@/lib/comfy/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getEngine().view());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; card?: Card; on?: boolean; until?: number };
  const e = getEngine();
  const card: Card = b.card === "boost" ? "boost" : "main";
  try {
    switch (b.action) {
      case "warm": return NextResponse.json(await e.warm(card));
      case "stop": await e.stop(card, "manual"); return NextResponse.json(e.view()[card]);
      case "boost": return NextResponse.json(await e.setBoost(!!b.on));
      case "keepWarm":
        if (typeof b.until !== "number" || !Number.isFinite(b.until)) return NextResponse.json({ error: "until required" }, { status: 400 });
        return NextResponse.json(e.keepWarm(b.until));
      default: return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "engine error" }, { status: 500 });
  }
}
