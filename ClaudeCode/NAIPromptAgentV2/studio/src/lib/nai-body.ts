import { splitTags, type Compiled } from "./prompt";

export type GenMode = "anime" | "furry";
export type Effort = "high" | "medium";
export type Quality = "standard" | "light" | "off";
export type UcPreset = "heavy" | "light" | "human" | "furry" | "none";

export type NaiParams = {
  model: string; width: number; height: number; steps: number; scale: number;
  sampler: string; noiseSchedule: string; cfgRescale: number; qualityToggle: boolean; seed?: number;
  /** Web-client parity (all optional so old drafts/recipes keep working). */
  mode?: GenMode; effort?: Effort; quality?: Quality; ucPreset?: UcPreset;
  /** Set on upscaled images: width/height stay the original recipe size; the PNG is this many times larger. */
  upscaled?: number;
};

export const MODELS = [
  { id: "nai-diffusion-5-full", label: "V5 Full" },
  { id: "nai-diffusion-5-curated", label: "V5 Curated" },
];

export const DEFAULT_PARAMS: NaiParams = {
  model: "nai-diffusion-5-full", width: 832, height: 1216, steps: 28, scale: 5,
  sampler: "k_euler_ancestral", noiseSchedule: "karras", cfgRescale: 0, qualityToggle: false,
  mode: "anime", effort: "high", quality: "standard", ucPreset: "heavy",
};

/** V5 quality tags, appended at the end of the base prompt (docs.novelai.net/en/image/qualitytags). */
export const QUALITY_TAGS: Record<Quality, string> = {
  standard: "very aesthetic, masterpiece, no text",
  light: "very aesthetic, amazing quality, no text",
  off: "",
};

/** V5 Full Undesired Content presets, put before the user's UC (docs.novelai.net/en/image/undesiredcontent). */
const HEAVY = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
export const UC_PRESETS: Record<UcPreset, string> = {
  heavy: HEAVY,
  light: "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::",
  human: `${HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
  furry: "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
  none: "",
};

const MEDIUM_MODEL = "nai-diffusion-5-full-medium";
/** A tag's identity for matching: weights and {}/[] stripped, lowercased; a ≤0 weight means "steer away" — not present. */
function tagKey(t: string): string {
  const m = t.trim().match(/^(-?[\d.]+)::([\s\S]*?)::?$/);
  if (m && Number(m[1]) <= 0) return "";
  return (m ? m[2] : t).replace(/[{}[\]]/g, "").trim().toLowerCase();
}
const hasTag = (s: string, tag: string) => splitTags(s).some((t) => tagKey(t) === tag);
/** Join parts, dropping tags already present (the preset and a hand-typed UC overlap; so do typed quality tags). */
function join(...parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of parts.flatMap((p) => splitTags(p))) {
    const k = tagKey(t) || t.trim();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t.trim());
  }
  return out.join(", ");
}

/** Params saved before presets existed: their text was already final — send it as written. */
export function legacyParams<P extends Partial<NaiParams>>(p: P): P & Pick<NaiParams, "quality" | "ucPreset"> {
  return p.quality === undefined ? { ...p, quality: "off", ucPreset: "none" } : p;
}

/** Anlas spent from a balance read before and after; unknown if a read failed, another spend overlapped, or it went up. */
export function costOf(before: number | null, after: number | null, overlapped: boolean): number | null {
  if (before === null || after === null || overlapped || after > before) return null;
  return before - after;
}

/**
 * What NovelAI's web client sends, composed here because the backend does not expand presets:
 * [fur dataset,] [nsfw,] base, quality tags · UC: [nsfw,] preset, user UC. Medium effort locks its settings.
 */
export function compose(c: Compiled, p: NaiParams): { c: Compiled; p: NaiParams } {
  const medium = p.effort === "medium" && p.model === "nai-diffusion-5-full";
  const nsfw = c.rating === "nsfw";
  const preset = medium ? "heavy" : (p.ucPreset ?? "heavy");
  const userUc = medium ? "" : c.uc; // Medium sends no custom UC: decide on what is actually sent
  const base = join(p.mode === "furry" ? "fur dataset" : "", nsfw && !hasTag(c.base, "nsfw") ? "nsfw" : "", c.base, QUALITY_TAGS[p.quality ?? "standard"]);
  // SFW: "nsfw" first in UC unless the prompt or the UC already carries it (NovelAI web behaviour).
  const sfwTag = !nsfw && !hasTag(c.base, "nsfw") && !hasTag(userUc, "nsfw") ? "nsfw" : "";
  const uc = join(sfwTag, UC_PRESETS[preset], userUc);
  const chars = medium ? c.chars.map((ch) => ({ ...ch, uc: "" })) : c.chars;
  const params = medium ? { ...p, model: MEDIUM_MODEL, steps: 14, sampler: "k_euler_ancestral", cfgRescale: 0 } : p;
  return { c: { ...c, base, uc, chars }, p: params };
}

/** The samplers NovelAI's web app offers for V4+ models. */
export const SAMPLERS = [
  { id: "k_euler_ancestral", label: "Euler Ancestral" },
  { id: "k_euler", label: "Euler" },
  { id: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
  { id: "k_dpmpp_2m", label: "DPM++ 2M" },
  { id: "k_dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { id: "k_dpmpp_sde", label: "DPM++ SDE" },
];
const SCHEDULES = ["karras", "exponential", "polyexponential"];

/** V4+ models reject "native"; every listed sampler takes these three. */
export function schedulesFor(sampler: string): string[] {
  return SAMPLERS.some((s) => s.id === sampler) ? SCHEDULES : ["karras"];
}

export function fixSchedule(p: NaiParams): NaiParams {
  const ok = schedulesFor(p.sampler);
  return ok.includes(p.noiseSchedule) ? p : { ...p, noiseSchedule: ok[0] };
}

/** Upscaled or huge images must never go back to NovelAI as a recipe or img2img source (huge paid requests). */
export function canResend(p: NaiParams): boolean {
  return !p.upscaled && p.width * p.height <= 4_194_304;
}

/** Image-to-image: base64 PNG of the source plus how far to move from it. */
export type Img2Img = { image: string; strength: number; noise: number };

/** Precise Reference: base64 PNG (no data: prefix) of the character sheet, how strongly to follow it, and fidelity. */
export type CharRef = { image: string; strength: number; fidelity: number };

const CENTER = { x: 0.5, y: 0.5 };

export function buildNaiBody(raw: Compiled, rawParams: NaiParams, img2img?: Img2Img, ref?: CharRef) {
  const { c, p } = compose(raw, rawParams);
  const seed = p.seed && p.seed > 0 ? p.seed : 1 + Math.floor(Math.random() * (2 ** 32 - 1));
  const useCoords = c.chars.some((ch) => ch.center);
  // The web client places characters by coordinates in the positive caption only; the negative carries none.
  const caption = (base: string, pick: (ch: Compiled["chars"][number]) => string, positive: boolean) => ({
    use_coords: positive && useCoords,
    use_order: positive && c.chars.length > 0,
    legacy_uc: false,
    caption: {
      base_caption: base,
      char_captions: c.chars.map((ch) => ({ char_caption: pick(ch), centers: [ch.center ?? CENTER] })),
    },
  });
  const body = {
    input: c.base,
    model: p.model,
    action: img2img ? "img2img" : "generate",
    parameters: {
      params_version: 4,
      width: p.width, height: p.height, scale: p.scale, sampler: p.sampler, steps: p.steps,
      // Presets/quality are already written into the text above (compose); tell the server to add nothing (4 = None).
      n_samples: 1, ucPreset: 4, qualityToggle: false,
      sm: false, sm_dyn: false, dynamic_thresholding: false, cfg_rescale: p.cfgRescale,
      noise_schedule: p.noiseSchedule, legacy: false, legacy_v3_extend: false,
      add_original_image: false, seed, extra_noise_seed: seed,
      negative_prompt: c.uc, prompt: c.base,
      characterPrompts: c.chars.map((ch) => ({ prompt: ch.prompt, uc: ch.uc, center: ch.center ?? CENTER, enabled: true })),
      v4_prompt: caption(c.base, (ch) => ch.prompt, true),
      v4_negative_prompt: caption(c.uc, (ch) => ch.uc, false),
      ...(img2img && { image: img2img.image, strength: img2img.strength, noise: img2img.noise, color_correct: true }),
      ...(ref && {
        director_reference_images: [ref.image],
        director_reference_descriptions: [{ caption: { base_caption: "character", char_captions: [] }, legacy_uc: false }],
        director_reference_information_extracted: [1],
        director_reference_strength_values: [ref.strength],
        director_reference_secondary_strength_values: [1 - ref.fidelity],
      }),
    },
  };
  return { body, seed };
}
