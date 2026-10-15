import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only list of RP images for the Camera roll's RP filter (never selectable or deletable there). */
export async function GET() {
  const images = db.prepare(`SELECT i.id, i.file, i.prompt, i.width, i.height, i.created_at createdAt, c.name character
    FROM rp_images i LEFT JOIN rp_chats ch ON ch.id = i.chat_id LEFT JOIN rp_characters c ON c.id = ch.character_id ORDER BY i.created_at DESC`).all();
  return NextResponse.json({ images });
}
