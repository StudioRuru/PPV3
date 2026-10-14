import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[\w-]+\.jpg$/.test(name)) return NextResponse.json({ error: "Bad name" }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, "chat-images", name));
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
}
