import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Like/dislike on an RP reply (+ optional note): teaches the companion how the owner likes stories. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (b?.kind !== "like" && b?.kind !== "dislike") return NextResponse.json({ error: "like or dislike" }, { status: 400 });
  recordEvent(b.kind, [], typeof b.note === "string" ? b.note.trim() : "", "miyabi", "rp");
  return NextResponse.json({ ok: true });
}
