import { NextRequest, NextResponse } from "next/server";
import { profileSpriteDir } from "@/lib/mascot/settings-db";
import { listSprites } from "@/lib/mascot/sprites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?profile=aru lists Aru's folder. { sprites: { "outfit/name": mtime }, sheets: { outfit: bool } } */
export async function GET(req: NextRequest) {
  return NextResponse.json(listSprites(profileSpriteDir(req.nextUrl.searchParams.get("profile"))));
}
