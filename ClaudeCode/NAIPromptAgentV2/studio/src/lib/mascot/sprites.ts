// Mascot sprite files + NovelAI request builder. Files live under data/mascot (see spec §1).
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, TAGGER_URL } from "../env";
import { DEFAULT_PARAMS, type NaiParams } from "../nai-body";
import type { Compiled } from "../prompt";
import { EXPRESSIONS, type Expression, type Outfit } from "./core";
import type { MascotSettings } from "./settings";

export const MASCOT_DIR = path.join(DATA_DIR, "mascot");
export const OUTFITS: Outfit[] = ["day", "night", "lewd"];
export type ArtKind = "bust" | "full";
export const MAX_CANDIDATES = 4;

export const BUST = "portrait, close-up, head and shoulders, bust, face focus, looking at viewer, simple background, white background";
export const BUST_UC = "full body, legs, thighs, feet, shoes, wide shot, lower body";
const FULL = "full body, standing, hand on hip, looking at viewer, simple background, white background";

/** A fresh random seed in 1..2^32-1, drawn per candidate so every batch differs. */
export const newSeed = (): number => randomInt(1, 2 ** 32);

/** Tags-only V5 request (no reference image: Precise Reference doesn't work on V5). */
export function spriteRequest(outfit: Outfit, kind: ArtKind, expr: Expression, s: MascotSettings, seed = newSeed()): { compiled: Compiled; params: NaiParams } {
  const parts = [s.charTags, s.constantTags, s.layerTags[outfit], ...(kind === "bust" ? [s.exprTags[expr], BUST] : [FULL])];
  const [width, height] = kind === "bust" ? [1024, 1024] : [832, 1216];
  return {
    compiled: { base: parts.map((p) => p.trim()).filter(Boolean).join(", "), uc: kind === "bust" ? BUST_UC : "", chars: [], rating: "nsfw" },
    params: { ...DEFAULT_PARAMS, width, height, steps: 28, seed },
  };
}

/** Anlas per image on Opus: free up to 1 Mpx at ≤28 steps; otherwise unknown until measured. */
export const perImage = (p: NaiParams): number | null => (p.width * p.height <= 1048576 && p.steps <= 28 ? 0 : null);

const isOutfit = (o: unknown): o is Outfit => OUTFITS.includes(o as Outfit);
const isName = (n: unknown): n is Expression | "full" => n === "full" || EXPRESSIONS.includes(n as Expression);

/** Untrusted {outfit, kind, expr} → a valid target (full ignores expr), or null. */
export function target(b: unknown): { outfit: Outfit; kind: ArtKind; expr: Expression; name: Expression | "full" } | null {
  const { outfit, kind = "bust", expr } = (b ?? {}) as Record<string, unknown>;
  if (!isOutfit(outfit) || (kind !== "bust" && kind !== "full")) return null;
  if (kind === "full") return { outfit, kind, expr: "smug", name: "full" };
  return EXPRESSIONS.includes(expr as Expression) ? { outfit, kind, expr: expr as Expression, name: expr as Expression } : null;
}

/** Whitelisted paths only: a known outfit and an expression or "full". */
export const spritePath = (dir: string, outfit: string, name: string): string | null =>
  isOutfit(outfit) && isName(name) ? path.join(dir, outfit, `${name}.png`) : null;

export const candidatePath = (dir: string, outfit: string, name: string, i: number): string | null =>
  isOutfit(outfit) && isName(name) && Number.isInteger(i) && i >= 0 && i < MAX_CANDIDATES ? path.join(dir, "candidates", outfit, name, `${i}.png`) : null;

export const sheetPath = (dir: string, outfit: Outfit) => path.join(dir, "sheets", `${outfit}.png`);

/** Existing sprites as "outfit/name" → mtime (for ?v= cache busting), plus sheet presence per outfit. */
export function listSprites(dir: string): { sprites: Record<string, number>; sheets: Record<Outfit, boolean> } {
  const sprites: Record<string, number> = {};
  for (const o of OUTFITS) {
    for (const n of [...EXPRESSIONS, "full"]) {
      const st = fs.statSync(path.join(dir, o, `${n}.png`), { throwIfNoEntry: false });
      if (st?.isFile()) sprites[`${o}/${n}`] = Math.floor(st.mtimeMs);
    }
  }
  const sheets = Object.fromEntries(OUTFITS.map((o) => [o, fs.existsSync(sheetPath(dir, o))])) as Record<Outfit, boolean>;
  return { sprites, sheets };
}

/** Replace the candidate batch for one sprite (stale files removed); seeds, if given, go in meta.json. */
export function saveCandidates(dir: string, outfit: Outfit, name: Expression | "full", pngs: Buffer[], seeds?: number[]): void {
  const d = path.dirname(candidatePath(dir, outfit, name, 0)!);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  pngs.slice(0, MAX_CANDIDATES).forEach((png, i) => fs.writeFileSync(path.join(d, `${i}.png`), png));
  if (seeds) fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ seeds: seeds.slice(0, MAX_CANDIDATES) }));
}

const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Cut out the candidate's background via the tagger and save it as the sprite (+ .orig.png). Cutout down → original + note. */
export async function pick(dir: string, outfit: string, name: string, i: number, fetchFn: typeof fetch = fetch): Promise<{ ok: true; note?: string } | { error: string }> {
  const src = candidatePath(dir, outfit, name, i);
  const out = spritePath(dir, outfit, name);
  if (!src || !out || !fs.existsSync(src)) return { error: "That candidate is gone — generate again." };
  const orig = fs.readFileSync(src);
  let cut: Buffer | null = null;
  try {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(orig)], { type: "image/png" }), "sprite.png");
    const r = await fetchFn(`${TAGGER_URL}/cutout`, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
    const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    if (b && isPng(b)) cut = b;
  } catch { /* cutout server down: keep the original */ }
  if (!cut && fs.existsSync(out)) return { error: "Background removal unavailable — kept your current sprite; try again when the tagger is warm." };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out.replace(/\.png$/, ".orig.png"), orig);
  fs.writeFileSync(out, cut ?? orig);
  return cut ? { ok: true } : { ok: true, note: "Background removal unavailable — saved the original with its background." };
}
