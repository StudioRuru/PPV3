import { NextResponse } from "next/server";
import { getEngine } from "@/lib/comfy/engine";
import { cachedModels } from "@/lib/comfy/client";
import { videoLoras } from "@/lib/comfy/loras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const eng = getEngine();
  if (eng.view().main.phase !== "ready") return NextResponse.json({ pending: true });
  try {
    const m = await cachedModels(eng.base("main"));
    return NextResponse.json({ ...m, videoLoras: await videoLoras(m.loras) });
  } catch {
    return NextResponse.json({ pending: true });
  }
}
