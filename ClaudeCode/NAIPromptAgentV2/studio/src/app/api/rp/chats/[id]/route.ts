import { NextRequest, NextResponse } from "next/server";
import { serializeModsJson } from "@/lib/rp/mods";
import { removeRpFiles, rp, rpSettings } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const view = (id: number) => ({ chat: rp.chat(id), messages: rp.messages(id), version: rp.version(id), globalMods: rpSettings().mods });
const CHAT_FIELDS = ["title", "personaId", "memorySummary", "authorNote", "authorNoteDepth", "lorebookId", "replyLength", "replySpice", "replyAgency", "model"] as const;

export async function GET(_req: NextRequest, { params }: Ctx) {
  const id = Number((await params).id);
  return rp.chat(id) ? NextResponse.json(view(id)) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * `{ op: "edit", msgId, content }`, `{ op: "swipe", msgId, index }`, `{ op: "rewind", msgId }` (delete after it) or
 * `{ op: "chat", ...fields }`. All carry `version`; a stale one is refused with 409.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const id = Number((await params).id);
  const b = await req.json().catch(() => null);
  if (!b || !rp.chat(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const expect = typeof b.version === "number" ? b.version : undefined;
  const msgId = Number(b.msgId);
  const own = () => rp.messages(id).some((m) => m.id === msgId);
  let ok = false;
  if (b.op === "edit" && typeof b.content === "string" && own()) ok = rp.edit(msgId, b.content, expect);
  else if (b.op === "swipe" && own()) ok = rp.pickSwipe(msgId, Number(b.index), expect);
  else if (b.op === "rewind" && own()) ok = rp.rewind(id, msgId, expect);
  else if (b.op === "chat") {
    // Metadata: last write wins and the message version doesn't move (safe while a reply is streaming).
    const fields: Record<string, unknown> = Object.fromEntries(CHAT_FIELDS.filter((k) => k in b).map((k) => [k, b[k]]));
    if (typeof b.mods === "string") fields.mods = serializeModsJson(b.mods); // unknown ids dropped, values clamped
    if (["text", "rp"].includes(b.style)) fields.style = b.style;
    if ([0, 1, null].includes(b.think)) fields.think = b.think; // null = follow the mode default
    rp.updateChat(id, fields);
    ok = true;
  } else return NextResponse.json({ error: "Unknown change." }, { status: 400 });
  if (!ok) return NextResponse.json({ error: "This chat changed on another device — reload it.", conflict: true, ...view(id) }, { status: 409 });
  return NextResponse.json(view(id));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  removeRpFiles(rp.deleteChat(Number((await params).id)));
  return NextResponse.json({ ok: true });
}
