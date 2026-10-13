import { NextRequest, NextResponse } from "next/server";
import { brainLoaded, brainUp, captionUp, setBrain, tipoUp } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status() {
  const [brain, caption, tipo] = await Promise.all([brainUp(), captionUp(), tipoUp()]);
  return { on: brain && (await brainLoaded()), brain, caption, tipo };
}

export async function GET() {
  return NextResponse.json(await status());
}

export async function POST(req: NextRequest) {
  const { on } = await req.json().catch(() => ({ on: false }));
  try {
    await setBrain(!!on);
  } catch (e) {
    return NextResponse.json({ ...(await status()), error: `Brain offline — start Ollama on the Mac. (${(e as Error).message})` }, { status: 503 });
  }
  return NextResponse.json(await status());
}
