import { NextRequest, NextResponse } from "next/server";
import { Offline, tipoComplete } from "@/lib/llm";
import { newTags, tipoPrompt } from "@/lib/tipo";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { tags = "", rating = "nsfw" } = (await req.json().catch(() => null)) ?? {};
  if (typeof tags !== "string" || !tags.trim()) return NextResponse.json({ tags: [] });
  try {
    const out = await tipoComplete(tipoPrompt(tags, rating === "safe" || rating === "off" ? rating : "nsfw"));
    return NextResponse.json({ tags: newTags(out, tags) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Offline ? "TIPO is off — turn the co-pilot on (or `npm run up` on the Mac)." : (e as Error).message }, { status: 503 });
  }
}
