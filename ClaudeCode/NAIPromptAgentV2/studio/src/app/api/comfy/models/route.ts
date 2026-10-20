import { NextResponse } from "next/server";
import { getEngine } from "@/lib/comfy/engine";
import { cachedModels } from "@/lib/comfy/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const eng = getEngine();
  if (eng.view().main.phase !== "ready") return NextResponse.json({ pending: true });
  try {
    return NextResponse.json(await cachedModels(eng.base("main")));
  } catch {
    return NextResponse.json({ pending: true });
  }
}
