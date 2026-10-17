import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { comfyDb, deleteItem, listItems } from "@/lib/comfy/store";
import { COMFY_DIR } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const b = Number(req.nextUrl.searchParams.get("before"));
  return NextResponse.json({ items: listItems(comfyDb(), Number.isInteger(b) && b > 0 ? b : undefined) });
}

export function DELETE(req: NextRequest) {
  const it = deleteItem(comfyDb(), Number(req.nextUrl.searchParams.get("id")));
  if (!it) return NextResponse.json({ error: "Not found" }, { status: 404 });
  for (const f of [it.file, it.poster]) if (f) fs.rmSync(path.join(COMFY_DIR, path.basename(f)), { force: true });
  return NextResponse.json({ ok: true });
}
