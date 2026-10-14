import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DATA_DIR } from "@/lib/env";
import { PERSONAS, type Modifiers, type PersonaId } from "@/lib/persona";
import { ThreadStore } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const store = () => new ThreadStore(db);
const isPersona = (p: unknown): p is PersonaId => PERSONAS.some((x) => x.id === p);

let lastSweep = 0;
/** At most hourly: delete chat images no message refers to that are over a day old (unsent attachments, edits). */
function sweepImages() {
  if (Date.now() - lastSweep < 3_600_000) return;
  lastSweep = Date.now();
  const dir = path.join(DATA_DIR, "chat-images");
  if (!fs.existsSync(dir)) return;
  const old = fs.readdirSync(dir).filter((f) => /^[\w-]+\.jpg$/.test(f) && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86_400_000);
  for (const f of store().unreferenced(old)) fs.rmSync(path.join(dir, f), { force: true });
}

export function GET() {
  try { sweepImages(); } catch { /* best effort */ }
  return NextResponse.json({ threads: store().list() });
}

/** { persona? } → a new empty thread. */
export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { persona?: unknown };
  const id = store().create("New chat", isPersona(b.persona) ? b.persona : "neutral");
  return NextResponse.json({ id, threads: store().list() });
}

/** { id, title?, persona?, mods? } */
export async function PATCH(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { id?: number; title?: unknown; persona?: unknown; mods?: Modifiers };
  if (typeof b.id !== "number") return NextResponse.json({ error: "id required" }, { status: 400 });
  store().update(b.id, {
    title: typeof b.title === "string" ? b.title : undefined,
    persona: isPersona(b.persona) ? b.persona : undefined,
    mods: b.mods && typeof b.mods === "object" ? { bratty: !!b.mods.bratty, tease: !!b.mods.tease, flirt: !!b.mods.flirt } : undefined,
  });
  return NextResponse.json({ threads: store().list() });
}

/** ?id= — deletes the thread, its messages and its attached images. */
export function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  for (const img of store().remove(id)) {
    if (/^[\w-]+\.jpg$/.test(img)) fs.rmSync(path.join(DATA_DIR, "chat-images", img), { force: true });
  }
  return NextResponse.json({ threads: store().list() });
}
