import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import extract from "png-chunks-extract";
import { decode } from "png-chunk-text";
import { emptyState, newLine, parseToLines, type PromptState } from "./prompt";
import type { NaiParams } from "./nai-body";

export type Recipe = {
  model?: string; base: string; chars: string[]; uc: string; artists: string[];
  seed?: number; sampler?: string; steps?: number; scale?: number; width?: number; height?: number;
};

type Raw = Record<string, unknown>;

function textChunks(png: Buffer): Raw | null {
  let chunks;
  try { chunks = extract(new Uint8Array(png)); } catch { return null; }
  const text: Raw = {};
  for (const c of chunks) if (c.name === "tEXt") { const t = decode(c); text[t.keyword] = t.text; }
  const looksNai = String(text.Software ?? "").toLowerCase().startsWith("novelai") || String(text.Source ?? "").toLowerCase().includes("novelai");
  return looksNai && text.Comment ? text : null;
}

/** NAI stealth metadata: alpha-channel LSBs, column-major, "stealth_png{comp,info}" magic. */
async function stealth(png: Buffer): Promise<Raw | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let i = 0;
  const bit = () => { const x = Math.floor(i / h), y = i % h; i++; return data[(y * w + x) * 4 + 3] & 1; };
  const bytes = (n: number) => {
    if (i + n * 8 > w * h) throw new Error("eof");
    const out = Buffer.alloc(n);
    for (let k = 0; k < n; k++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bit(); out[k] = v; }
    return out;
  };
  try {
    const magic = bytes(15).toString("utf8");
    if (magic !== "stealth_pngcomp" && magic !== "stealth_pnginfo") return null;
    const len = bytes(4).readUInt32BE(0) / 8;
    const payload = bytes(len);
    return JSON.parse((magic === "stealth_pngcomp" ? gunzipSync(payload) : payload).toString("utf8"));
  } catch {
    return null;
  }
}

export async function readRecipe(png: Buffer): Promise<Recipe | null> {
  const raw = textChunks(png) ?? (await stealth(png));
  if (!raw) return null;
  let c: Raw;
  try { c = typeof raw.Comment === "string" ? JSON.parse(raw.Comment) : (raw.Comment as Raw) ?? {}; } catch { return null; }
  const v4 = (c.v4_prompt as { caption?: { base_caption?: string; char_captions?: { char_caption?: string }[] } })?.caption;
  const v4n = (c.v4_negative_prompt as { caption?: { base_caption?: string } })?.caption;
  const base = (v4?.base_caption ?? (c.prompt as string) ?? "").trim();
  const chars = (v4?.char_captions ?? []).map((x) => (x.char_caption ?? "").trim()).filter(Boolean);
  const artists = [...new Set(`${c.prompt ?? ""}, ${base}`.match(/artist:[^,|:]+/gi)?.map((a) => a.trim()) ?? [])];
  return {
    model: (raw.Source ?? raw.Software) as string | undefined,
    base, chars, uc: (v4n?.base_caption ?? (c.uc as string) ?? "").trim(), artists,
    seed: c.seed as number | undefined, sampler: c.sampler as string | undefined, steps: c.steps as number | undefined,
    scale: c.scale as number | undefined, width: c.width as number | undefined, height: c.height as number | undefined,
  };
}

export function recipeToState(r: Recipe): { state: PromptState; params: Partial<NaiParams> } {
  const state: PromptState = {
    ...emptyState(),
    rating: "off",
    base: parseToLines(r.base),
    uc: r.uc,
    chars: r.chars.map((p) => ({ id: newLine().id, lines: parseToLines(p), uc: "", enabled: true })),
  };
  const params: Partial<NaiParams> = {};
  if (r.seed) params.seed = r.seed;
  if (r.sampler) params.sampler = r.sampler;
  if (r.steps) params.steps = r.steps;
  if (r.scale) params.scale = r.scale;
  if (r.width && r.height) { params.width = r.width; params.height = r.height; }
  return { state, params };
}
