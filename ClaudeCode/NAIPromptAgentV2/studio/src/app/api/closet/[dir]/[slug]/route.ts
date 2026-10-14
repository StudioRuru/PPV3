import { NextRequest, NextResponse } from "next/server";
import type { Field } from "@/lib/closet";
import { Conflict, readItem, saveItem, trashItem } from "@/lib/closet-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ dir: string; slug: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { dir, slug } = await params;
  const item = readItem(dir, slug);
  return item ? NextResponse.json({ item }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}

/** { fields, mtime, op? } — saves only changed fields into the shared YAML; 409 if it changed on disk meanwhile. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { dir, slug } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as { fields?: Field[]; mtime?: number; op?: { scene: "add" } | { scene: "remove"; index: number } };
  if (!Array.isArray(b.fields) || typeof b.mtime !== "number") return NextResponse.json({ error: "Fields and mtime are required." }, { status: 400 });
  try {
    return NextResponse.json({ item: saveItem(dir, slug, b.fields, b.mtime, b.op) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof Conflict ? 409 : 400 });
  }
}

/** Moves the file to data/.trash (never erased). */
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const { dir, slug } = await params;
  try { trashItem(dir, slug); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
