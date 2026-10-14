import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { DATA_DIR, TAGGER_URL } from "@/lib/env";
import { caption, focusQuery, Offline, toModelImage } from "@/lib/llm";
import { DEFAULT_ENABLED, DEFAULT_EXCLUDE, filterTags, type RawTag } from "@/lib/tagger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Image for the chat (multipart: file, focus). Saved ≤1 Mpx; the tagger's tags + a ToriiGate caption steered by the
 * focus question become the "eyes report" for the brain. Each step degrades gracefully if its server is off.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const focus = String(form?.get("focus") ?? "").slice(0, 300);
  if (!(file instanceof Blob) || !file.size) return NextResponse.json({ error: "No image attached." }, { status: 400 });
  let dataUrl: string;
  try { dataUrl = await toModelImage(Buffer.from(await file.arrayBuffer())); }
  catch { return NextResponse.json({ error: "That file isn't an image this Mac can read (try a JPEG or PNG — HEIC from the share sheet is converted automatically)." }, { status: 422 }); }

  const name = `${crypto.randomUUID()}.jpg`;
  const dir = path.join(DATA_DIR, "chat-images");
  fs.mkdirSync(dir, { recursive: true });
  const jpg = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(path.join(dir, name), jpg);

  const notes: string[] = [];
  let tags = "";
  try {
    const fd = new FormData(); fd.append("file", new Blob([jpg], { type: "image/jpeg" }), "image.jpg");
    const r = await fetch(`${TAGGER_URL}/tag`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
    const d = await r.json();
    if (r.ok) tags = filterTags(d.tags as RawTag[], { thresholds: d.thresholds, enabled: DEFAULT_ENABLED, exclude: DEFAULT_EXCLUDE }).join(", ");
  } catch { notes.push("tagger offline"); }

  let report = "";
  try { report = await caption(dataUrl, focusQuery(tags, focus)); }
  catch (e) { notes.push(e instanceof Offline ? "ToriiGate offline — the brain will look itself" : "caption failed"); }
  return NextResponse.json({ image: name, tags, caption: report, notes });
}
