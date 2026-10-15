import { NextRequest, NextResponse } from "next/server";
import { embed } from "@/lib/llm";
import { rp, rpSettings } from "@/lib/rp/server";
import { embedVoiceLines } from "@/lib/rp/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save a line `{ id?, characterId, text, context }`, or `{ embed: characterId }` to (re)embed that character's lines. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (b?.embed) {
    try {
      return NextResponse.json(await embedVoiceLines(rp, Number(b.embed), rpSettings().embedModel, embed));
    } catch (e) {
      return NextResponse.json({ error: `Couldn't embed — is ${rpSettings().embedModel} installed in Ollama? (${(e as Error).message})` }, { status: 503 });
    }
  }
  const characterId = Number(b?.characterId);
  if (!rp.character(characterId) || typeof b?.text !== "string" || !b.text.trim()) return NextResponse.json({ error: "A line needs text." }, { status: 400 });
  const id = rp.saveVoiceLine({ id: b.id ? Number(b.id) : undefined, characterId, text: b.text.trim(), context: typeof b.context === "string" ? b.context.trim() : "" });
  // Embed right away when possible; a line without a vector is just skipped by retrieval.
  await embedVoiceLines(rp, characterId, rpSettings().embedModel, embed).catch(() => null);
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest) {
  rp.deleteVoiceLine(Number(req.nextUrl.searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
