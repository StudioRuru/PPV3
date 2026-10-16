import { NextRequest, NextResponse } from "next/server";
import { profileSpriteDir } from "@/lib/mascot/settings-db";
import { listSprites } from "@/lib/mascot/sprites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?profile=aru lists Aru's folder. { sprites: { key: mtime }, sheets: { outfit: bool }, clips: { baseKey: { kind: frames } }, clipMeta: { baseKey: { v, masks? } } } */
export async function GET(req: NextRequest) {
  return NextResponse.json(listSprites(profileSpriteDir(req.nextUrl.searchParams.get("profile"))));
}
