import { NextRequest, NextResponse } from "next/server";
import { companionFold } from "@/lib/companion/fold";
import { db } from "@/lib/db";
import { ThreadStore } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?thread=id → that thread's messages (with attached image names). */
export function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("thread"));
  if (!Number.isInteger(id)) return NextResponse.json({ messages: [] });
  return NextResponse.json({ messages: new ThreadStore(db).messages(id) });
}

/** { thread, messages } — save an edited history (e.g. a reply the user corrected) without asking the brain. */
export async function PUT(req: Request) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { thread?: number; version?: number; messages?: { role: string; content: string; image?: string | null }[] };
  const store = new ThreadStore(db);
  if (typeof b.thread !== "number" || !store.list().some((t) => t.id === b.thread) || !Array.isArray(b.messages)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const ok = store.replace(b.thread, b.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, image: typeof m.image === "string" ? m.image : null })), typeof b.version === "number" ? b.version : undefined);
  if (ok && store.list().find((t) => t.id === b.thread)?.mode === "companion") companionFold();
  return ok ? NextResponse.json({ ok: true, version: store.version(b.thread) })
    : NextResponse.json({ error: "This chat changed on another device — reloaded it.", conflict: true }, { status: 409 });
}
