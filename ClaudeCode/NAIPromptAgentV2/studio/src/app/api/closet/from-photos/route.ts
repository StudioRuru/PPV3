import { NextRequest, NextResponse } from "next/server";
import { createItem } from "@/lib/closet-store";
import { TAGGER_URL } from "@/lib/env";
import { caption, focusQuery, Offline, toModelImage } from "@/lib/llm";
import { outfitFromTags, slotOf, SLOTS, tagsInProse } from "@/lib/outfit-photo";
import { yamlGroups } from "@/lib/tag-index";
import type { RawTag } from "@/lib/tagger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLOTHES = new Set(["clothing", "accessories", "footwear", "materials", "states"]);
// A lone color says nothing about which garment it is.
const BARE_COLOR = /^(black|white|red|blue|green|pink|purple|yellow|orange|brown|grey|gray|silver|gold|aqua|beige|navy|multicolored)$/;
const FOCUS = "every garment, accessory, shoe, legwear and material: exact colors, cuts, trims, patterns, and how each is worn, opened, pulled or torn";

/** Photos → tagger → clothing tags bucketed into a new outfit file. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof Blob && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Add at least one photo." }, { status: 400 });
  const name = String(form?.get("name") ?? "").trim() || "Photo outfit";

  const photos: { tags: RawTag[]; threshold: number }[] = [];
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f, "upload");
    let res: Response;
    try {
      res = await fetch(`${TAGGER_URL}/tag`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
    } catch {
      return NextResponse.json({ error: "Tagger offline — run `npm run tagger` on the Mac." }, { status: 503 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: data.detail ?? `Tagger error ${res.status}` }, { status: 502 });
    photos.push({ tags: data.tags ?? [], threshold: data.thresholds?.general ?? 0.35 });
  }

  const stems = yamlGroups();
  const slots = outfitFromTags(photos, stems);

  // Vision pass: the captioner looks at each photo for clothing the tagger missed. Optional — off just means tagger-only.
  let vision = "vision pass skipped (captioner off)";
  const vocab = [...stems].filter(([t, stem]) => CLOTHES.has(stem) && !BARE_COLOR.test(t)).map(([t]) => t);
  try {
    for (const f of files) {
      const found = SLOTS.flatMap((s) => slots[s]);
      const prose = await caption(await toModelImage(Buffer.from(await f.arrayBuffer())), focusQuery(found.join(", "), FOCUS));
      for (const t of tagsInProse(prose, vocab, found)) slots[slotOf(t, stems.get(t)) ?? "tops"].push(t);
    }
    vision = "plus vision pass";
  } catch (e) {
    if (!(e instanceof Offline) && !/paused/i.test((e as Error).message)) vision = `vision pass failed: ${(e as Error).message}`;
  }

  if (!SLOTS.some((s) => slots[s].length)) return NextResponse.json({ error: "No clothing found in those photos." }, { status: 422 });
  const item = createItem("outfit", name, { fields: [
    { path: ["description"], label: "Description", type: "text", value: `From ${files.length} photo${files.length > 1 ? "s" : ""} via tagger, ${vision}` },
    ...SLOTS.map((s) => ({ path: ["tags", s], label: s, type: "tags" as const, value: slots[s] })),
  ] });
  return NextResponse.json({ item });
}
