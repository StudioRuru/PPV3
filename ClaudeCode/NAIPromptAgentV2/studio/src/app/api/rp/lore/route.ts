import { NextRequest, NextResponse } from "next/server";
import { extractLorebookFromCard, parseLorebookObject } from "@/lib/rp/cards";
import { rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lorebooks; `?id=` adds that book's entries. */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  return NextResponse.json({ lorebooks: rp.lorebooks(), ...(id ? { entries: rp.entries(id).map(({ embedding, embedModel, ...e }) => ({ ...e, embedded: !!embedding })) } : {}) });
}

/** `{ lorebook: { id?, name, description } }` or `{ entry: { id?, lorebookId, keys, content, enabled, constant, ... } }`. */
/** Multipart `file`: a SillyTavern World Info / character_book JSON (or a card JSON with one embedded) becomes a new lorebook. */
export async function POST(req: NextRequest) {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    if (Number(req.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) return NextResponse.json({ error: "That lorebook is too big (8 MB max)." }, { status: 413 });
    const f = (await req.formData().catch(() => null))?.get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
    let raw: unknown = null;
    try { raw = JSON.parse(await f.text()); } catch { return NextResponse.json({ error: "That isn't a JSON lorebook." }, { status: 400 }); }
    const book = parseLorebookObject(raw) ?? extractLorebookFromCard(raw);
    if (!book) return NextResponse.json({ error: "No lorebook entries found in that file." }, { status: 400 });
    const id = rp.importLorebook(book, f.name.replace(/\.json$/i, "") || "Imported lore");
    return NextResponse.json({ id, entries: book.entries.length });
  }
  const b = await req.json().catch(() => null);
  if (b?.lorebook && typeof b.lorebook.name === "string" && b.lorebook.name.trim()) {
    return NextResponse.json({ id: rp.saveLorebook({ id: b.lorebook.id, name: b.lorebook.name.trim(), description: String(b.lorebook.description ?? "") }) });
  }
  const e = b?.entry;
  if (e && Number(e.lorebookId) && rp.lorebooks().some((l) => l.id === Number(e.lorebookId))) {
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : undefined);
    return NextResponse.json({
      id: rp.saveEntry({
        id: e.id ? Number(e.id) : undefined, lorebookId: Number(e.lorebookId), keys: strs(e.keys), secondaryKeys: strs(e.secondaryKeys),
        content: typeof e.content === "string" ? e.content : undefined, enabled: typeof e.enabled === "boolean" ? e.enabled : undefined,
        constant: typeof e.constant === "boolean" ? e.constant : undefined, insertionOrder: Number.isFinite(e.insertionOrder) ? e.insertionOrder : undefined,
        position: e.position === "before" || e.position === "after" ? e.position : undefined,
        probability: Number.isFinite(e.probability) ? Math.max(0, Math.min(100, e.probability)) : undefined,
        scanDepth: Number.isFinite(e.scanDepth) ? Math.max(0, e.scanDepth) : undefined,
      }),
    });
  }
  return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
}

/** `?entry=` or `?lorebook=`. */
export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("entry")) rp.deleteEntry(Number(q.get("entry")));
  else if (q.get("lorebook")) rp.deleteLorebook(Number(q.get("lorebook")));
  return NextResponse.json({ ok: true });
}
