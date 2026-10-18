import fs from "node:fs";
import { NextResponse } from "next/server";
import { SPRITE_LIB } from "@/lib/env";
import { safeLibPath } from "@/lib/sprites/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: Record<string, string> = { ".webp": "image/webp", ".json": "application/json" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const file = safeLibPath(SPRITE_LIB, parts);
  const type = TYPES[parts[parts.length - 1].match(/\.[a-z]+$/)?.[0] ?? ""];
  if (!file || !type) return NextResponse.json({ error: "Bad path" }, { status: 400 });
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
}
