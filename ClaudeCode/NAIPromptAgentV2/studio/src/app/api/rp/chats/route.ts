import { NextRequest, NextResponse } from "next/server";
import { rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** New chat with a character, opened by its greeting. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const characterId = Number(b?.characterId);
  if (!rp.character(characterId)) return NextResponse.json({ error: "That character was deleted." }, { status: 404 });
  const id = rp.createChat(characterId, b?.personaId ? Number(b.personaId) : null);
  return NextResponse.json({ chat: rp.chat(id), messages: rp.messages(id), version: rp.version(id) });
}
