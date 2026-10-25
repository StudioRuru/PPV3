import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { DEFAULT_PARAMS } from "@/lib/nai-body";
import { generateImage, measured, NovelAIError } from "@/lib/novelai";
import { getMascotSettings } from "@/lib/mascot/settings-db";
import { newSeed } from "@/lib/mascot/sprites";
import { TRAINSET_DIR, addSpent, idx, nextIndex, readPicks, readSpent, trainsetRenders, writePicks } from "@/lib/sprites/trainset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  const files = await fsp.readdir(TRAINSET_DIR).catch(() => [] as string[]);
  const picked = new Set(await readPicks());
  const renders = files.filter((f) => /^\d+\.png$/.test(f)).map((f) => parseInt(f, 10)).sort((a, b) => a - b).map((i) => ({ i, picked: picked.has(i) }));
  return NextResponse.json({ renders, spent: await readSpent() });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { n?: unknown; pick?: unknown; on?: unknown } | null;
  await fsp.mkdir(TRAINSET_DIR, { recursive: true });
  if (b && Number.isInteger(b.pick) && typeof b.on === "boolean") {
    const set = new Set(await readPicks());
    if (b.on) set.add(b.pick as number); else set.delete(b.pick as number);
    await writePicks([...set].sort((a, c) => a - c));
    return NextResponse.json({ ok: true });
  }
  if (!b || !Number.isInteger(b.n) || (b.n as number) < 1) return bad("Say how many to render.");
  if (!NOVELAI_TOKEN) return bad("NOVELAI_TOKEN is not set on the server.", 500);
  const n = Math.min(100, b.n as number);
  const start = nextIndex(await fsp.readdir(TRAINSET_DIR));
  let made = 0, error: string | undefined;
  for (const r of trainsetRenders(getMascotSettings(), start, n)) {
    try {
      const compiled = { base: r.tags, uc: "", chars: [], rating: r.outfit === "lewd" ? "nsfw" as const : "safe" as const };
      const { result, cost } = await measured(NOVELAI_TOKEN, () => generateImage(compiled, { ...DEFAULT_PARAMS, seed: newSeed() }, NOVELAI_TOKEN));
      await fsp.writeFile(path.join(TRAINSET_DIR, `${idx(r.i)}.txt`), r.caption);
      await fsp.writeFile(path.join(TRAINSET_DIR, `${idx(r.i)}.png`), result.png); // png last: it is what marks a render as done
      await addSpent(cost ?? 0);
      made++;
    } catch (e) {
      error = e instanceof Error ? e.message : "Render failed.";
      if (!(e instanceof NovelAIError)) console.error("[trainset]", e);
      break;
    }
  }
  if (!made && error) return bad(error, 502);
  return NextResponse.json({ made, spent: await readSpent(), error });
}
