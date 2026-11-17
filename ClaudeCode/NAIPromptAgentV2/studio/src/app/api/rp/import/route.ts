import { NextRequest, NextResponse } from "next/server";
import { importCard } from "@/lib/rp/import";
import { refreshProfile } from "@/lib/rp/profile";
import { askHeavy, avatarForModel, rp, saveRpFile } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Import a Tavern/Chub card: multipart `file` (PNG/JSON) or JSON `{ url }`. Embedded lorebooks come along. */
export async function POST(req: NextRequest) {
  let input: { file?: { name: string; bytes: Buffer }; url?: string } = {};
  if (Number(req.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) return NextResponse.json({ error: "That file is too big for a character card (8 MB max)." }, { status: 413 });
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
    lorebookId = rp.importLorebook(r.lorebook, `${r.character.name} lore`);
  }
  const avatarPath = r.avatar ? saveRpFile("avatars", r.avatar.bytes, r.avatar.ext) : null;
  const id = rp.saveCharacter({ ...r.character, avatarPath, lorebookId });
  // Detached: the profile lands a few seconds later; a failure only logs and leaves `profile` null.
  void avatarForModel(avatarPath).then((a) => refreshProfile(rp, id, a, askHeavy)).catch(() => {});
  return NextResponse.json({ character: rp.character(id) });
}
