import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { heavyModel, installedModels, rpSettings, saveRpSettings } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: rpSettings(), heavy: heavyModel(), quick: getSetting("model.quick") ?? "", models: await installedModels() });
}

/** `{ settings?: Partial<RpSettings>, heavy?: model, quick?: model }` — models must be installed. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const models = await installedModels();
  for (const tier of ["heavy", "quick"] as const) {
    if (typeof b?.[tier] !== "string") continue;
    if (b[tier] && !models.includes(b[tier])) return NextResponse.json({ error: `${b[tier]} isn't installed in Ollama.` }, { status: 400 });
    setSetting(`model.${tier}`, b[tier]);
  }
  const settings = b?.settings && typeof b.settings === "object" ? saveRpSettings(b.settings) : rpSettings();
  return NextResponse.json({ settings, heavy: heavyModel(), quick: getSetting("model.quick") ?? "", models });
}
