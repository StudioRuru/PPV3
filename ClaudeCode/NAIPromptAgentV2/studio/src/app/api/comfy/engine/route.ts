import { NextResponse } from "next/server";
import { getEngine, Refused } from "@/lib/comfy/engine";
import { stopJobs } from "@/lib/comfy/jobs";
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
      case "stop":
        stopJobs(card); // jobs first, so a drain can't re-warm the card
        await e.stop(card, "manual");
        return NextResponse.json(e.view()[card]);
      case "flush": // delete the VM and its downloaded models
        stopJobs(card);
        await e.stop(card, "flush");
        return NextResponse.json(e.view()[card]);
      case "boost":
        if (typeof b.on !== "boolean") return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
        if (!b.on) stopJobs("boost");
        return NextResponse.json(await e.setBoost(b.on));
      case "keepWarm":
        if (typeof b.until !== "number" || !Number.isFinite(b.until)) return NextResponse.json({ error: "until required" }, { status: 400 });
        return NextResponse.json(e.keepWarm(b.until));
      default: return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 409 });
    // HyperstackError messages are key-scrubbed; answer generically.
    console.error("comfy engine route failed:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : "unknown");
    return NextResponse.json({ error: "The GPU service failed — try again." }, { status: 500 });
  }
}
