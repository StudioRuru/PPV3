import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { incomingProfile } from "@/lib/rp/profile";
import { rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gallery: characters with their chat count and last activity. */
export async function GET() {
  const stats = new Map((db.prepare("SELECT character_id id, COUNT(*) n, MAX(updated_at) last FROM rp_chats GROUP BY character_id").all() as { id: number; n: number; last: number }[]).map((r) => [r.id, r]));
  const list = rp.characters().map((c) => ({ ...c, chats: stats.get(c.id)?.n ?? 0, lastChat: stats.get(c.id)?.last ?? null }));
  list.sort((a, b) => (b.lastChat ?? b.updatedAt) - (a.lastChat ?? a.updatedAt));
  return NextResponse.json({ characters: list });
}

/** Create or update a character (fields as in RpCharacter; unknown keys are ignored). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "A character needs a name." }, { status: 400 });
  if (body.id && !rp.character(Number(body.id))) return NextResponse.json({ error: "That character was deleted." }, { status: 404 });
  const { createdAt: _c, updatedAt: _u, ...fields } = body;
  const prev = body.id ? rp.character(Number(body.id)) : null;
  // A changed profile from the sheet is a hand edit; an unchanged one rides along untouched.
  if ("profile" in fields) fields.profile = incomingProfile(fields.profile, prev?.profile ?? null);
  const id = rp.saveCharacter({ ...fields, id: body.id ? Number(body.id) : undefined, name: body.name.trim().slice(0, 120) });
  return NextResponse.json({ character: rp.character(id) });
}
