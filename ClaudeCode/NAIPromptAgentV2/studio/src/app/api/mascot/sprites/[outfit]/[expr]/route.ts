import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { profileSpriteDir } from "@/lib/mascot/settings-db";
import { candidatePath, spritePath } from "@/lib/mascot/sprites";

export const runtime = "nodejs";

/** /api/mascot/sprites/<outfit>/<expression|full>?v=<mtime>[&profile=aru] serves the sprite; ?c=<i> serves studio candidate i. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ outfit: string; expr: string }> }) {
  const { outfit, expr } = await params;
  const c = req.nextUrl.searchParams.get("c");
  const dir = profileSpriteDir(req.nextUrl.searchParams.get("profile"));
  const file = c === null ? spritePath(dir, outfit, expr) : candidatePath(dir, outfit, expr, Number(c));
  if (!file || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: { "Content-Type": "image/png", "Cache-Control": c === null ? "private, max-age=31536000, immutable" : "no-store" },
  });
}
