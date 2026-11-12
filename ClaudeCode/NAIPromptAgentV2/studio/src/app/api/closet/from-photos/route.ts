import { NextRequest, NextResponse } from "next/server";
import { createItem } from "@/lib/closet-store";
import { TAGGER_URL } from "@/lib/env";
import { caption, chatStream, focusQuery, toModelImage } from "@/lib/llm";
import { outfitFromTags, slotOf, SLOTS, tagsInProse } from "@/lib/outfit-photo";
import { parseRead, READ_SYSTEM } from "@/lib/read-image";
import { knownTags, yamlGroups } from "@/lib/tag-index";
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

  // Vision pass: captioner prose matched against the vocab, then the brain names garments in its own words —
  // real tags join the slots, the rest become optional extras. Either service off just skips its part.
  const vocab = [...stems].filter(([t, stem]) => CLOTHES.has(stem) && !BARE_COLOR.test(t)).map(([t]) => t);
  const optional: string[] = [], used: string[] = [];
  const known = knownTags();
  for (const f of files) {
    const img = await toModelImage(Buffer.from(await f.arrayBuffer())).catch(() => null);
    if (!img) continue;
    const have = new Set(SLOTS.flatMap((s) => slots[s]));
    const prose = await caption(img, focusQuery([...have].join(", "), FOCUS)).catch(() => "");
    if (prose) used.push("captioner");
    for (const t of tagsInProse(prose, vocab, [...have])) { slots[slotOf(t, stems.get(t)) ?? "tops"].push(t); have.add(t); }
    try {
      let reply = "";
      for await (const c of chatStream(READ_SYSTEM, [{ role: "user", content: `${prose ? `Detailed caption:\n${prose}\n\n` : ""}Only the main person's clothing: every garment, accessory, shoe, legwear, material and clothing state, with colors. Put them in characters[0]; leave base empty.`, images: [img.split(",")[1]] }], { options: { temperature: 0.2 } })) reply += c;
      for (const t of parseRead(reply).characters[0] ?? []) {
        if (have.has(t) || optional.includes(t)) continue;
        const s = known.has(t) ? slotOf(t, stems.get(t)) : null;
        if (s) slots[s].push(t); else optional.push(t);
        have.add(t);
      }
      used.push("brain");
    } catch { /* brain off or paused: tagger (+ captioner) still stands */ }
  }
  const vision = used.length ? `plus ${[...new Set(used)].join(" + ")}` : "vision pass skipped (captioner + brain off)";

  if (!SLOTS.some((s) => slots[s].length)) return NextResponse.json({ error: "No clothing found in those photos." }, { status: 422 });
  const item = createItem("outfit", name, { fields: [
    { path: ["description"], label: "Description", type: "text", value: `From ${files.length} photo${files.length > 1 ? "s" : ""} via tagger, ${vision}` },
    ...SLOTS.map((s) => ({ path: ["tags", s], label: s, type: "tags" as const, value: slots[s] })),
    { path: ["optional"], label: "optional", type: "tags" as const, value: optional },
  ] });
  return NextResponse.json({ item });
}
