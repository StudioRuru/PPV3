import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { getMascotSettings } from "@/lib/mascot/settings-db";
import { MASCOT_DIR, MAX_CANDIDATES, OUTFITS, perImage, pick, saveCandidates, sheetPath, spriteRequest, target } from "@/lib/mascot/sprites";
import type { Outfit } from "@/lib/mascot/core";
import { anlas, generateImage, measured, NovelAIError } from "@/lib/novelai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SHEET = 20 * 1024 * 1024;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const balance = () => anlas(NOVELAI_TOKEN, 5000).catch(() => null);

/** Mascot studio: sheet upload (multipart), estimate, generate (confirm: true), pick. */
export async function POST(req: NextRequest) {
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    const outfit = fd?.get("outfit");
    const file = fd?.get("file");
    if (fd?.get("action") !== "sheet" || !OUTFITS.includes(outfit as Outfit)) return bad("Expected action=sheet and an outfit.");
    if (!(file instanceof Blob) || !file.size || file.size > MAX_SHEET || !file.type.startsWith("image/")) return bad("Upload an image up to 20 MB.");
    const out = sheetPath(MASCOT_DIR, outfit as Outfit);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true });
  }

  const b = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown; n?: unknown; i?: unknown; confirm?: unknown };
  const t = target(b);
  if (!t) return bad("Unknown outfit or expression.");
  const n = Number.isInteger(b.n) ? Math.min(MAX_CANDIDATES, Math.max(1, b.n as number)) : 3;

  if (b.action === "estimate") {
    return NextResponse.json({ anlas: await balance(), perImage: perImage(spriteRequest(t.outfit, t.kind, t.expr, getMascotSettings()).params), n });
  }
  if (b.action === "generate") {
    if (b.confirm !== true) return bad("Confirm the spend first.");
    const s = getMascotSettings();
    try {
      const before = await balance();
      const seeds: number[] = [];
      const { result: pngs, cost } = await measured(NOVELAI_TOKEN, async () => {
        const out: Buffer[] = [];
        for (let i = 0; i < n; i++) {
          const { compiled, params } = spriteRequest(t.outfit, t.kind, t.expr, s);
          seeds.push(params.seed);
          out.push((await generateImage(compiled, params, NOVELAI_TOKEN)).png);
        }
        return out;
      });
      saveCandidates(MASCOT_DIR, t.outfit, t.name, pngs, seeds); // only after the whole batch, so a failure replaces nothing
      return NextResponse.json({ count: pngs.length, before, after: await balance(), cost });
    } catch (err) {
      const status = err instanceof NovelAIError ? err.status : 500;
      return bad((err as Error).message, status >= 400 ? status : 502);
    }
  }
  if (b.action === "pick") {
    const r = await pick(MASCOT_DIR, t.outfit, t.name, Number(b.i));
    return "error" in r ? bad(r.error, 404) : NextResponse.json(r);
  }
  return bad("Unknown action.");
}
