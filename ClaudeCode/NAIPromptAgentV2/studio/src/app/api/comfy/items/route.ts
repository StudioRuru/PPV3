import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { decode } from "@/lib/comfy/decode";
import { addItem, comfyDb, deleteItem, findImported, listItems, readItem } from "@/lib/comfy/store";
import { COMFY_DIR } from "@/lib/env";
import { readGeneration } from "@/lib/generations";

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

let seq = 0;
/** {image: dataURL} imports a phone photo; {generation: id} copies a NovelAI image in (once). → {item} */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { image?: unknown; generation?: unknown } | null;
  const db = comfyDb();
  let png: Buffer, recipe: object, seed = 0;
  if (typeof b?.generation === "number") {
    const done = findImported(db, b.generation);
    if (done) return NextResponse.json({ item: done });
    const g = await readGeneration(b.generation);
    if (!g) return NextResponse.json({ error: "That NovelAI image is gone." }, { status: 404 });
    [png, recipe, seed] = [g.png, { source: "nai", generation: g.id }, g.seed];
  } else {
    try { png = await decode(b?.image); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    recipe = { source: "import" };
  }
  const file = `import-${Date.now()}-${seq++ % 1000}.png`;
  fs.mkdirSync(COMFY_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMFY_DIR, `.${file}.tmp`), png);
  fs.renameSync(path.join(COMFY_DIR, `.${file}.tmp`), path.join(COMFY_DIR, file));
  const id = addItem(db, { kind: "photo", file, poster: null, recipe, seed, cost: 0, createdAt: Date.now() });
  return NextResponse.json({ item: readItem(db, id) });
}
