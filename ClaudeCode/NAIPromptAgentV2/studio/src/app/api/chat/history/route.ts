import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const rows = db.prepare("SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 100").all();
  return NextResponse.json({ messages: rows.reverse() });
}

export function DELETE() {
  db.exec("DELETE FROM chat_messages");
  return NextResponse.json({ ok: true });
}
