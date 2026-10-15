import { NextRequest, NextResponse } from "next/server";
import { heavyGate } from "@/lib/llm";
import { analyzeEssence, draftCard, researchSource, synthesizeCard } from "@/lib/rp/draft";
import { IngestError, searchWiki } from "@/lib/rp/ingest";
import { heavyModel, rpSettings } from "@/lib/rp/server";
import { coerceResearchModifiers } from "@/lib/rp/studio-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/**
 * Character studio (heavy model). Nothing is saved here — results are staged for review.
 * - `{ action: "search", wiki, query }` → wiki pages
 * - `{ action: "draft", concept }` → card
 * - `{ action: "analyze", samples, name }` → card + state seeds
 * - `{ action: "research", name, pageUrls, modifiers }` → NDJSON progress, then `{ type: "done", card, entries, voiceLines }`
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) ?? {};
  const settings = { ...rpSettings(), studioModel: heavyModel() };

  if (b.action === "search") {
    try { return NextResponse.json({ results: await searchWiki(String(b.wiki ?? ""), String(b.query ?? "")) }); }
    catch (e) { return fail(e instanceof IngestError ? e.message : errText(e), 502); }
  }
  if (b.action === "draft") {
    const concept = typeof b.concept === "string" ? b.concept.trim() : "";
    if (!concept) return fail("Describe the character first.");
    try {
      const card = await heavyGate.run(() => draftCard(concept, settings));
      return card.name || card.description || card.personality ? NextResponse.json({ card }) : fail("The model didn't return a usable card. Try again or refine the concept.", 502);
    } catch (e) { return fail(errText(e), 502); }
  }
  if (b.action === "analyze") {
    const samples = typeof b.samples === "string" ? b.samples.trim() : "";
    if (samples.length < 20) return fail("Paste a bit more sample conversation to analyze.");
    try {
      const r = await heavyGate.run(() => analyzeEssence(samples, typeof b.name === "string" ? b.name : "", settings));
      return r.card.personality || r.card.description ? NextResponse.json(r) : fail("Couldn't capture much from that sample. Try a longer or clearer excerpt.", 502);
    } catch (e) { return fail(errText(e), 502); }
  }
  if (b.action !== "research") return fail("Unknown action.");

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const pageUrls = (Array.isArray(b.pageUrls) ? b.pageUrls : []).filter((u: unknown): u is string => typeof u === "string" && !!u.trim()).slice(0, 5);
  if (!name) return fail("A character name is required.");
  if (!pageUrls.length) return fail("Add at least one page to research.");
  const modifiers = coerceResearchModifiers(b.modifiers);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (o: unknown) => { try { ctl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* client gone */ } };
      try {
        await heavyGate.run(async () => {
          const src = await researchSource(name, pageUrls, settings, (p) => send({ type: "progress", ...p }), req.signal);
          send({ type: "progress", phase: "writing", message: `Writing ${name}…` });
          const card = await synthesizeCard(name, src.sourceExcerpt, src.entries, modifiers, settings);
          send({ type: "done", card, entries: src.entries, voiceLines: src.voiceLines, title: src.title, source: pageUrls[0] });
        }, (note) => send({ type: "progress", phase: "pause", message: note }));
      } catch (e) {
        send({ type: "error", message: errText(e) });
      }
      try { ctl.close(); } catch { /* gone */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
