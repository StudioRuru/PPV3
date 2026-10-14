import { NextRequest, NextResponse } from "next/server";
import { caption, Offline, toModelImage, toriiQuery } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Upload failed or image too large (max 40 MB)." }, { status: 400 });
  let img: string;
  try { img = await toModelImage(Buffer.from(await file.arrayBuffer())); }
  catch { return NextResponse.json({ error: "That file isn't an image." }, { status: 422 }); }
  try {
    return NextResponse.json({ caption: await caption(img, toriiQuery(String(fd!.get("tags") ?? ""))) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Offline ? "Captioner is off — turn the co-pilot on (or `npm run up` on the Mac)." : (e as Error).message }, { status: 503 });
  }
}
