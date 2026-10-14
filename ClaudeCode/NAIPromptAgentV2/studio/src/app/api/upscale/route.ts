import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { saveImage } from "@/lib/gallery";
import { insertGeneration, readGeneration } from "@/lib/generations";
import { canResend, DEFAULT_PARAMS } from "@/lib/nai-body";
import { anlas, NovelAIError, upscaleImage } from "@/lib/novelai";
import { withNaiMetadata } from "@/lib/recipe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const id = Number(((await req.json().catch(() => null)) ?? {}).id);
  const src = await readGeneration(id);
  if (!src) return NextResponse.json({ error: "That image is no longer in the gallery." }, { status: 404 });
  const p = { ...DEFAULT_PARAMS, ...src.params };
  if (!canResend(p)) return NextResponse.json({ error: "This image is already upscaled." }, { status: 400 });
  try {
    const before = await anlas(NOVELAI_TOKEN).catch(() => null);
    // NovelAI's upscaler returns a bare PNG: carry the source's recipe over so it still imports.
    const png = withNaiMetadata(await upscaleImage(src.png, p.width, p.height, p.model, NOVELAI_TOKEN), src.png);
    const after = await anlas(NOVELAI_TOKEN).catch(() => null);
    const file = await saveImage(png, src.seed);
    const newId = insertGeneration({ model: p.model, seed: src.seed, file, state: src.state, params: { ...p, upscaled: 4 }, gridId: `u${src.id}`, cost: before !== null && after !== null ? before - after : null });
    return NextResponse.json({ id: newId, file });
  } catch (e) {
    const status = e instanceof NovelAIError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status: status >= 400 ? status : 502 });
  }
}
