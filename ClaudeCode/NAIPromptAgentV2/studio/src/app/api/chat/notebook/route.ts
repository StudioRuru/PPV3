import { NextRequest, NextResponse } from "next/server";
import { Notebook } from "@/lib/companion/notebook";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const book = () => new Notebook(db);
const notes = () => NextResponse.json({ notes: book().live() });
const missing = () => NextResponse.json({ error: "No such note." }, { status: 404 });

export function GET() {
  return notes();
}

/** { id, text } — the owner rewrites a note. */
export async function PATCH(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; text?: unknown };
  if (!Number.isInteger(b.id) || typeof b.text !== "string" || !b.text.trim()) return NextResponse.json({ error: "id and text required" }, { status: 400 });
  return book().ownerEdit(b.id as number, b.text) ? notes() : missing();
}

/** ?id= — the owner deletes a note. */
export function DELETE(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("id");
  const id = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  return book().ownerDelete(id) ? notes() : missing();
}
