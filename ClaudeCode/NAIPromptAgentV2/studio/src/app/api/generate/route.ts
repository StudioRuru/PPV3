import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOVELAI_TOKEN } from "@/lib/env";
import { saveImage } from "@/lib/gallery";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { generateImage, NovelAIError } from "@/lib/novelai";
import { compile, hasContent, type PromptState } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { state, params } = (await req.json().catch(() => ({}))) as { state?: PromptState; params?: Partial<NaiParams> };
  if (!state?.base) return NextResponse.json({ error: "Missing prompt state." }, { status: 400 });
  if (!hasContent(state)) return NextResponse.json({ error: "Base prompt is empty." }, { status: 400 });
  const compiled = compile(state);
  const p = { ...DEFAULT_PARAMS, ...params };
  try {
    const { png, seed } = await generateImage(compiled, p, NOVELAI_TOKEN);
    const file = await saveImage(png, seed);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO generations (created_at, model, seed, file, state, params) VALUES (?, ?, ?, ?, ?, ?)")
      .run(Date.now(), p.model, seed, file, JSON.stringify(state), JSON.stringify({ ...p, seed }));
    return NextResponse.json({ id: Number(lastInsertRowid), file, seed });
  } catch (err) {
    const status = err instanceof NovelAIError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status: status >= 400 ? status : 502 });
  }
}
