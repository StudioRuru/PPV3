import { DEFAULT_PHOTO_NEGATIVE, DEFAULT_VIDEO_NEGATIVE, family, type Family, type PhotoRecipe, type VideoRecipe } from "./recipe";

export const PHOTO_DRAFT_KEY = "studio-comfy-photo-v1";

// Krea 2: turbo template (8 steps, CFG 1). MOSS: Comfy-Org SFT template.
const TUNE: Record<Family, Pick<PhotoRecipe, "steps" | "cfg" | "sampler" | "scheduler">> = {
  sdxl: { steps: 28, cfg: 5.5, sampler: "euler_ancestral", scheduler: "normal" },
  qwen: { steps: 25, cfg: 3, sampler: "euler", scheduler: "simple" },
  krea2: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" },
  moss: { steps: 25, cfg: 2.5, sampler: "er_sde", scheduler: "simple" },
};

export function photoTune(model: string): Pick<PhotoRecipe, "steps" | "cfg" | "sampler" | "scheduler"> {
  return TUNE[family(model)];
}

export function defaultPhoto(models: string[]): PhotoRecipe {
  const model = models[0] ?? "";
  return { mode: "photo", model, prompt: "", negative: DEFAULT_PHOTO_NEGATIVE, loras: [], pose: null, seed: -1, ...photoTune(model), width: 832, height: 1216, hires: null };
}

/** Per-device convenience only; storage can be blocked, so never throw. The pose is session-only (its image lives on the server). */
export function loadPhoto(): PhotoRecipe | null {
  try {
    const o = JSON.parse(localStorage.getItem(PHOTO_DRAFT_KEY) ?? "null");
    if (!o || typeof o !== "object" || o.mode !== "photo") return null;
    const d = defaultPhoto([]);
    const out: Record<string, unknown> = { ...d };
    for (const k of Object.keys(d) as (keyof PhotoRecipe)[]) {
      const v = o[k], w = d[k];
      if (typeof w === "number" ? typeof v === "number" && Number.isFinite(v) : typeof w === "string" ? typeof v === "string" : false) out[k] = v;
    }
    const h = o.hires;
    if (h && Number.isFinite(h.scale) && Number.isFinite(h.denoise)) out.hires = { scale: h.scale, denoise: h.denoise };
    if (o.faceFix === true) out.faceFix = true;
    if (Array.isArray(o.loras)) out.loras = o.loras.filter((l: { name?: unknown; strength?: unknown }) => typeof l?.name === "string" && typeof l.strength === "number" && Number.isFinite(l.strength)).map((l: { name: string; strength: number; words?: unknown }) => ({ name: l.name, strength: l.strength, ...(Array.isArray(l.words) && l.words.length <= 10 && l.words.every((w) => typeof w === "string" && w.length <= 80) ? { words: l.words as string[] } : {}) }));
    return out as PhotoRecipe;
  } catch { return null; }
}

export function savePhoto(r: PhotoRecipe): void {
  try { localStorage.setItem(PHOTO_DRAFT_KEY, JSON.stringify({ ...r, pose: null })); } catch {}
}

export const VIDEO_DRAFT_KEY = "studio-comfy-video-v3"; // v3: Smooth Mix at 20 steps, CFG 3.5

/** 20 steps / CFG 3.5 for both models. Smooth Mix v2.0 has no lightx2v baked in, so 8 steps / CFG 1 came out ghosted. */
export function videoTune(mode: VideoRecipe["mode"]): { steps: number; cfg: number } {
  return { steps: 20, cfg: 3.5 };
}

export function defaultVideo(): VideoRecipe {
  return { mode: "animate", prompt: "", negative: DEFAULT_VIDEO_NEGATIVE, loras: [], start: null, end: null, seconds: 5, motion: "medium", fps: 60, size: "480p", seed: -1, ...videoTune("animate") };
}

const ENUMS = { mode: ["animate", "t2v", "extend", "loop"], motion: ["low", "medium", "high"], fps: [16, 30, 60], size: ["480p", "720p"] } as const;

/** Same rules as loadPhoto: every stored field is type-checked, anything off falls back to the default. */
export function loadVideo(): VideoRecipe | null {
  try {
    const o = JSON.parse(localStorage.getItem(VIDEO_DRAFT_KEY) ?? "null");
    if (!o || typeof o !== "object") return null;
    const d = defaultVideo();
    const out: Record<string, unknown> = { ...d };
    for (const k of Object.keys(d) as (keyof VideoRecipe)[]) {
      const v = o[k], w = d[k];
      if (k in ENUMS) { if ((ENUMS[k as keyof typeof ENUMS] as readonly unknown[]).includes(v)) out[k] = v; }
      else if (typeof w === "number") { if (typeof v === "number" && Number.isFinite(v)) out[k] = v; }
      else if (typeof w === "string") { if (typeof v === "string") out[k] = v; }
    }
    for (const k of ["start", "end"] as const) if (Number.isInteger(o[k]) && o[k] > 0) out[k] = o[k];
    if (Array.isArray(o.loras)) out.loras = o.loras.filter((l: { name?: unknown; strength?: unknown }) => typeof l?.name === "string" && typeof l.strength === "number" && Number.isFinite(l.strength)).map((l: { name: string; strength: number; words?: unknown }) => ({ name: l.name, strength: l.strength, ...(Array.isArray(l.words) && l.words.length <= 10 && l.words.every((w) => typeof w === "string" && w.length <= 80) ? { words: l.words as string[] } : {}) }));
    return out as VideoRecipe;
  } catch { return null; }
}

export function saveVideo(r: VideoRecipe): void {
  try { localStorage.setItem(VIDEO_DRAFT_KEY, JSON.stringify(r)); } catch {}
}
