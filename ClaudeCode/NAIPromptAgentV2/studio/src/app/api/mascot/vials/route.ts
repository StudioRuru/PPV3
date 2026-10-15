import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { liveIdentity, quip, slimeStore } from "@/lib/mascot/quip";
import { listing, vialAction, type VialDeps } from "@/lib/mascot/vial-api";
import { VialStore } from "@/lib/mascot/vial-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps: VialDeps = {
  db,
  store: slimeStore,
  live: liveIdentity,
  vials: new VialStore(db),
  quip: async (data) => { const { expression, text } = await quip({ event: { kind: "vial_drop", data } }); return { expression, text }; },
};

/** Bottles, recipes, Undo/Neutral vials, jars with their potions/doses/poison. */
export async function GET() {
  return NextResponse.json(listing(deps));
}

/** `{ action, … }`: bottle | parse | discard | brew | forget | drop | undo | neutral (see vial-api.ts). */
export async function POST(req: NextRequest) {
  const r = await vialAction(await req.json().catch(() => null), deps);
  return NextResponse.json(r.body, { status: r.status });
}
