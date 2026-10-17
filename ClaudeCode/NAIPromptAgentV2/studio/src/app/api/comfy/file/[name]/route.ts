import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { COMFY_DIR } from "@/lib/env";
import { safeGalleryName } from "@/lib/gallery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Streams a Library file. Honors Range — iOS Safari won't play an mp4 without 206 responses. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const raw = (await params).name;
  const name = safeGalleryName(raw) ?? (/^[\w-]+\.mp4$/.test(raw) ? raw : null);
  if (!name) return NextResponse.json({ error: "Bad name" }, { status: 400 });
  const file = path.join(COMFY_DIR, name);
  const size = fs.statSync(file, { throwIfNoEntry: false })?.size;
  if (size === undefined) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": name.endsWith(".mp4") ? "video/mp4" : "image/png",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (!size) return new NextResponse(null, { headers: { ...headers, "Content-Length": "0" } }); // end -1 would make createReadStream throw
  const body = (start: number, end: number) => Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m || (!m[1] && !m[2])) return new NextResponse(body(0, size - 1), { headers: { ...headers, "Content-Length": String(size) } });
  // "bytes=a-b", "bytes=a-" or the suffix form "bytes=-n"
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  return new NextResponse(body(start, end), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
