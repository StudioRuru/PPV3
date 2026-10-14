import { NextRequest, NextResponse } from "next/server";
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
  const b = ((await req.json().catch(() => null)) ?? {}) as { thread?: number; messages?: { role: string; content: string; image?: string | null }[] };
  const store = new ThreadStore(db);
  if (typeof b.thread !== "number" || !store.list().some((t) => t.id === b.thread) || !Array.isArray(b.messages)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  store.replace(b.thread, b.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, image: typeof m.image === "string" ? m.image : null })));
  return NextResponse.json({ ok: true });
}
