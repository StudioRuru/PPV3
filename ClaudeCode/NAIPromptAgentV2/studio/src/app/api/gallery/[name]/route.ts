import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { GALLERY_DIR } from "@/lib/env";
import { safeGalleryName } from "@/lib/gallery";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = safeGalleryName((await params).name);
  if (!name) return NextResponse.json({ error: "Bad name" }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(GALLERY_DIR, name));
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
