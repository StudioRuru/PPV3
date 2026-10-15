import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { activeSpriteDir } from "@/lib/mascot/settings-db";
import { poseCandidatePath, posePath } from "@/lib/mascot/sprites";

export const runtime = "nodejs";

/** /api/mascot/sprites/pose/<pose>/<outfit>/<expr> (back: pose/back/<outfit>)?v=<mtime>; ?c=<i> serves studio candidate i. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ p: string[] }> }) {
  const [pose, outfit, expr = null] = (await params).p;
  const c = req.nextUrl.searchParams.get("c");
  const dir = activeSpriteDir();
  const file = c === null ? posePath(dir, pose, outfit, expr) : poseCandidatePath(dir, pose, outfit, expr, Number(c));
  if (!file || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: { "Content-Type": "image/png", "Cache-Control": c === null ? "private, max-age=31536000, immutable" : "no-store" },
  });
}
