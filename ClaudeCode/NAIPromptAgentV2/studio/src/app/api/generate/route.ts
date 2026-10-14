import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { saveImage } from "@/lib/gallery";
import { insertGeneration, readGeneration } from "@/lib/generations";
import { DEFAULT_PARAMS, fixSchedule, type Img2Img, type NaiParams } from "@/lib/nai-body";
import { generateImage, NovelAIError } from "@/lib/novelai";
import { compile, hasContent, type PromptState } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    state?: PromptState; params?: Partial<NaiParams>; gridId?: unknown; source?: { id?: unknown; strength?: unknown; noise?: unknown };
  };
  const grid = typeof body.gridId === "string" && /^[\w-]{1,40}$/.test(body.gridId) ? body.gridId : null;
  let state = body.state;
  let p = fixSchedule({ ...DEFAULT_PARAMS, ...body.params });
  let img2img: Img2Img | undefined;

  // Variations: image-to-image from a saved generation, using that image's own recipe and size.
  if (body.source) {
    const src = await readGeneration(Number(body.source.id));
    if (!src) return NextResponse.json({ error: "That image is no longer in the gallery." }, { status: 404 });
    state = src.state;
    p = fixSchedule({ ...DEFAULT_PARAMS, ...src.params, seed: body.params?.seed });
    img2img = { image: src.png.toString("base64"), strength: clamp(body.source.strength, 0.05, 0.95, 0.45), noise: clamp(body.source.noise, 0, 0.99, 0) };
  }

  if (!state?.base) return NextResponse.json({ error: "Missing prompt state." }, { status: 400 });
  if (!hasContent(state)) return NextResponse.json({ error: "Base prompt is empty." }, { status: 400 });
  try {
    const { png, seed } = await generateImage(compile(state), p, NOVELAI_TOKEN, img2img);
    const file = await saveImage(png, seed);
    const id = insertGeneration({ model: p.model, seed, file, state, params: { ...p, seed }, gridId: grid });
    return NextResponse.json({ id, file, seed });
  } catch (err) {
    const status = err instanceof NovelAIError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status: status >= 400 ? status : 502 });
  }
}
