import { NextRequest, NextResponse } from "next/server";
import { caption, chatStream, focusQuery, Offline, toModelImage } from "@/lib/llm";
import { parseRead, READ_SYSTEM, toLines } from "@/lib/read-image";
import { knownTags } from "@/lib/tag-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOCUS = "each character separately, left to right: hair, eyes, body, every garment and accessory with colors, clothing state, expression, pose";

/** Image → brain (Gemma vision, helped by tagger tags + a ToriiGate caption) → base + one line set per character. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Add an image first." }, { status: 400 });
  const tags = String(form?.get("tags") ?? "").slice(0, 4000);
  const img = await toModelImage(Buffer.from(await file.arrayBuffer())).catch(() => null);
  if (!img) return NextResponse.json({ error: "That file isn't an image." }, { status: 400 });

  // The captioner is a bonus: off or paused just means the brain looks alone.
  const prose = await caption(img, focusQuery(tags, FOCUS)).catch(() => "");
  const notes = `${tags ? `Tagger tags: ${tags}\n` : ""}${prose ? `Detailed caption:\n${prose}` : ""}`;
  let reply = "";
  try {
    for await (const c of chatStream(READ_SYSTEM, [{ role: "user", content: `${notes}\n\nList the base and every character as JSON.`, images: [img.split(",")[1]] }], { options: { temperature: 0.2 } })) reply += c;
    const read = parseRead(reply);
    const known = knownTags();
    return NextResponse.json({ base: toLines(read.base, known), chars: read.characters.map((c) => toLines(c, known)), captioned: !!prose });
  } catch (e) {
    const msg = e instanceof Offline ? "Brain offline — run `npm run up` on the Mac." : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: e instanceof Offline ? 503 : 502 });
  }
}
