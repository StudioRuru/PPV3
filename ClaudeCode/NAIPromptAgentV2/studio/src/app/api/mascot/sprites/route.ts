import { NextResponse } from "next/server";
import { listSprites, MASCOT_DIR } from "@/lib/mascot/sprites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { sprites: { "outfit/name": mtime }, sheets: { outfit: bool } } */
export async function GET() {
  return NextResponse.json(listSprites(MASCOT_DIR));
}
