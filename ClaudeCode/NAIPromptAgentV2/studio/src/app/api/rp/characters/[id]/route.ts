import { NextRequest, NextResponse } from "next/server";
import { toCardV2 } from "@/lib/rp/cards";
import { removeRpFiles, rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Character sheet data; `?export=1` downloads a Tavern V2 card (with its lorebook). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const c = rp.character(Number((await params).id));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("export")) {
    const lore = c.lorebookId ? { name: rp.lorebooks().find((l) => l.id === c.lorebookId)?.name ?? "", entries: rp.entries(c.lorebookId) } : null;
    return new NextResponse(JSON.stringify(toCardV2(c, lore), null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${c.name.replace(/[^\w-]+/g, "_") || "card"}.json"` },
    });
  }
  const voiceLines = rp.voiceLines(c.id).map(({ embedding, ...v }) => ({ ...v, embedded: !!embedding }));
  return NextResponse.json({ character: c, chats: rp.chats(c.id), voiceLines });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const files = rp.deleteCharacter(Number((await params).id));
  removeRpFiles(files);
  return NextResponse.json({ ok: true });
}
