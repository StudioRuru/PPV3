import { NextRequest, NextResponse } from "next/server";
import { createItem } from "@/lib/closet-store";
import { TAGGER_URL } from "@/lib/env";
import { chatStream, toModelImage } from "@/lib/llm";
import { outfitFromTags, slotOf, SLOTS } from "@/lib/outfit-photo";
import { parseRead, READ_SYSTEM } from "@/lib/read-image";
import { knownTags, yamlGroups } from "@/lib/tag-index";
import type { RawTag } from "@/lib/tagger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


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

  // Vision pass: the brain names garments in its own words — real tags join the slots, the rest become optional extras.
  // No ToriiGate caption (+~2 min/photo for little gain); brain off just skips it.
  const optional: string[] = [], used: string[] = [];
  const known = knownTags();
  for (const f of files) {
    const img = await toModelImage(Buffer.from(await f.arrayBuffer())).catch(() => null);
    if (!img) continue;
    const have = new Set(SLOTS.flatMap((s) => slots[s]));
    try {
      let reply = "";
      for await (const c of chatStream(READ_SYSTEM, [{ role: "user", content: `Only the main person's clothing: every garment, accessory, shoe, legwear, material and clothing state, with colors. Put them in characters[0]; leave base empty.`, images: [img.split(",")[1]] }], { think: false, options: { temperature: 0.2 } })) reply += c;
      for (const t of parseRead(reply).characters[0] ?? []) {
        if (have.has(t) || optional.includes(t)) continue;
        const s = known.has(t) ? slotOf(t, stems.get(t)) : null;
        if (s) slots[s].push(t); else optional.push(t);
        have.add(t);
      }
      used.push("brain");
    } catch { /* brain off or paused: tagger still stands */ }
  }
  const vision = used.length ? `plus ${[...new Set(used)].join(" + ")}` : "vision pass skipped (brain off)";

  if (!SLOTS.some((s) => slots[s].length)) return NextResponse.json({ error: "No clothing found in those photos." }, { status: 422 });
  const item = createItem("outfit", name, { fields: [
    { path: ["description"], label: "Description", type: "text", value: `From ${files.length} photo${files.length > 1 ? "s" : ""} via tagger, ${vision}` },
    ...SLOTS.map((s) => ({ path: ["tags", s], label: s, type: "tags" as const, value: slots[s] })),
    { path: ["optional"], label: "optional", type: "tags" as const, value: optional },
  ] });
  return NextResponse.json({ item });
}
