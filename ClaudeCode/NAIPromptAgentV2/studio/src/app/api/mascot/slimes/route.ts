import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { BRAIN_MODEL } from "@/lib/env";
import { chatStream, heavyGate } from "@/lib/llm";
import { liveIdentity, quip, slimeStore } from "@/lib/mascot/quip";
import { saveMascotSettings } from "@/lib/mascot/settings-db";
import { listing, slimeAction, type SlimeDeps } from "@/lib/mascot/slime-ai";
import { rp } from "@/lib/rp/server";
import { tierModel } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps: SlimeDeps = {
  store: slimeStore,
  live: { read: () => liveIdentity.read(), patch: (p) => { saveMascotSettings(p); } },
  ask: (system, user) => heavyGate.run(async () => {
    let s = "";
    for await (const c of chatStream(system, [{ role: "user", content: user }], { model: tierModel("heavy", getSetting, BRAIN_MODEL), options: { num_predict: 700 } })) s += c;
    return s;
  }),
  quip: async (kind) => { const { expression, text } = await quip({ event: { kind } }); return { expression, text }; },
  card: (id) => rp.character(id),
};

/** Shelf: jars, active id, empty, live sliders + heat drift. */
export async function GET() {
  return NextResponse.json(listing(deps));
}

/** `{ action, … }`: extract | remove | insert | rename | recolor | delete | sliders | heatDrift | mix | fromRp (see slime-ai.ts). */
export async function POST(req: NextRequest) {
  const r = await slimeAction(await req.json().catch(() => null), deps);
  return NextResponse.json(r.body, { status: r.status });
}
