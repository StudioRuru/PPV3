import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { DATA_DIR, GALLERY_DIR } from "@/lib/env";
import { safeGalleryName } from "@/lib/gallery";

export const runtime = "nodejs";

const THUMBS = path.join(DATA_DIR, "thumbs");
const WIDTHS = new Set([256, 512]);

/** The full PNG (metadata intact), or with ?w=256|512 a small cached WebP for grids — ~20 KB instead of ~1.5 MB. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const name = safeGalleryName((await params).name);
  if (!name) return NextResponse.json({ error: "Bad name" }, { status: 400 });
  const w = Number(req.nextUrl.searchParams.get("w"));
  const cache = { "Cache-Control": "private, max-age=31536000, immutable" };
  try {
    if (!WIDTHS.has(w)) {
      const buf = await fs.readFile(path.join(GALLERY_DIR, name));
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", ...cache } });
    }
    const thumb = path.join(THUMBS, `${name.replace(/\.png$/, "")}-${w}.webp`);
    const make = async () => {
      const out = await sharp(path.join(GALLERY_DIR, name)).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      await fs.mkdir(THUMBS, { recursive: true });
      await fs.writeFile(thumb, out);
      return out;
    };
    const buf = (await fs.readFile(thumb).catch(() => null)) ?? (await make());
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/webp", ...cache } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
