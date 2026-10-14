import { NextRequest, NextResponse } from "next/server";
import { DIRS, type Field, type Kind } from "@/lib/closet";
import { createItem, listCloset } from "@/lib/closet-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ items: listCloset() });
}

/** { kind, name, from?: {dir, slug}, fields? } — new item (template, duplicate, or "from current prompt"). */
export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { kind?: Kind; name?: string; from?: { dir: string; slug: string }; fields?: Field[] };
  if (!b.kind || !(b.kind in DIRS) || !b.name?.trim()) return NextResponse.json({ error: "Kind and name are required." }, { status: 400 });
  try {
    return NextResponse.json({ item: createItem(b.kind, b.name.trim(), { from: b.from, fields: b.fields }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
