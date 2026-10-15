import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { rpFile } from "@/lib/rp/files";
import { RP_DIR } from "@/lib/rp/server";

export const runtime = "nodejs";

const TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Serves RP avatars and images: /api/rp/files/avatars/<name> or /api/rp/files/images/<name>. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await params;
  const file = rpFile(RP_DIR, kind, name);
  if (!file || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: { "Content-Type": TYPE[name.split(".").pop()!.toLowerCase()], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
