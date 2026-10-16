import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { clipPath, decodeBaseKey } from "@/lib/mascot/clips";
import { profileSpriteDir } from "@/lib/mascot/settings-db";
import { clipCandidatePath } from "@/lib/mascot/sprites";

export const runtime = "nodejs";

/** /api/mascot/sprites/clips/<baseKey with / as ~>/<kind>/<n>?v=<clipMeta.v>[&profile=aru]; ?c=<i> serves frame n of studio candidate run i. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string; kind: string; n: string }> }) {
  const { key, kind, n } = await params;
  const baseKey = decodeBaseKey(key), q = req.nextUrl.searchParams.get("c"), c = q && /^\d$/.test(q) ? q : null; // only a digit is a candidate request
  const dir = profileSpriteDir(req.nextUrl.searchParams.get("profile"));
  const file = !baseKey || !/^\d$/.test(n) ? null : c === null ? clipPath(dir, baseKey, kind, Number(n)) : clipCandidatePath(dir, baseKey, kind, Number(c), Number(n));
  if (!file || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: { "Content-Type": "image/png", "Cache-Control": c === null ? "private, max-age=31536000, immutable" : "no-store" },
  });
}
