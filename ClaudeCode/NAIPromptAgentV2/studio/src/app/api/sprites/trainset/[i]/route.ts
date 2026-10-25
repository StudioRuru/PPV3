import fsp from "node:fs/promises";
import path from "node:path";
import { TRAINSET_DIR, idx } from "@/lib/sprites/trainset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Thumbnail source for the picker. */
export async function GET(_: Request, { params }: { params: Promise<{ i: string }> }) {
  const { i } = await params;
  if (!/^\d{1,4}$/.test(i)) return new Response("Not found", { status: 404 });
  const png = await fsp.readFile(path.join(TRAINSET_DIR, `${idx(Number(i))}.png`)).catch(() => null);
  return png ? new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "max-age=31536000, immutable" } }) : new Response("Not found", { status: 404 });
}
