import { NextRequest, NextResponse } from "next/server";
import { importCard } from "@/lib/rp/import";
import { rp, saveRpFile } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Import a Tavern/Chub card: multipart `file` (PNG/JSON) or JSON `{ url }`. Embedded lorebooks come along. */
export async function POST(req: NextRequest) {
  let input: { file?: { name: string; bytes: Buffer }; url?: string } = {};
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const f = (await req.formData().catch(() => null))?.get("file");
    if (f instanceof File) input = { file: { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) } };
  } else {
    const b = await req.json().catch(() => null);
    if (typeof b?.url === "string") input = { url: b.url };
  }
  const r = await importCard(input);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  let lorebookId: number | null = null;
  if (r.lorebook) {
    lorebookId = rp.saveLorebook({ name: r.lorebook.name || `${r.character.name} lore` });
    for (const e of r.lorebook.entries) rp.saveEntry({ lorebookId, keys: e.keys, content: e.content, enabled: e.enabled, insertionOrder: e.insertionOrder });
  }
  const avatarPath = r.avatar ? saveRpFile("avatars", r.avatar.bytes, r.avatar.ext) : null;
  const id = rp.saveCharacter({ ...r.character, avatarPath, lorebookId });
  return NextResponse.json({ character: rp.character(id) });
}
