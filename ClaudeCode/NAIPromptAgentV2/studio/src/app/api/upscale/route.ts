import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { saveImage } from "@/lib/gallery";
import { insertGeneration, readGeneration } from "@/lib/generations";
import { DEFAULT_PARAMS } from "@/lib/nai-body";
import { NovelAIError, upscaleImage } from "@/lib/novelai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const id = Number(((await req.json().catch(() => null)) ?? {}).id);
  const src = await readGeneration(id);
  if (!src) return NextResponse.json({ error: "That image is no longer in the gallery." }, { status: 404 });
  const p = { ...DEFAULT_PARAMS, ...src.params };
  try {
    const png = await upscaleImage(src.png, p.width, p.height, p.model, NOVELAI_TOKEN);
    const file = await saveImage(png, src.seed);
    const newId = insertGeneration({ model: p.model, seed: src.seed, file, state: src.state, params: { ...p, width: p.width * 4, height: p.height * 4 }, gridId: `u${src.id}` });
    return NextResponse.json({ id: newId, file });
  } catch (e) {
    const status = e instanceof NovelAIError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status: status >= 400 ? status : 502 });
  }
}
