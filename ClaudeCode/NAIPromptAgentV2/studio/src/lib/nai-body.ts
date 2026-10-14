import type { Compiled } from "./prompt";

export type NaiParams = {
  model: string; width: number; height: number; steps: number; scale: number;
  sampler: string; noiseSchedule: string; cfgRescale: number; qualityToggle: boolean; seed?: number;
};

export const MODELS = [
  { id: "nai-diffusion-5-full", label: "V5 Full" },
  { id: "nai-diffusion-5-curated", label: "V5 Curated" },
];

export const DEFAULT_PARAMS: NaiParams = {
  model: "nai-diffusion-5-full", width: 832, height: 1216, steps: 28, scale: 5,
  sampler: "k_euler_ancestral", noiseSchedule: "karras", cfgRescale: 0, qualityToggle: false,
};

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

/** Image-to-image: base64 PNG of the source plus how far to move from it. */
export type Img2Img = { image: string; strength: number; noise: number };

const CENTER = { x: 0.5, y: 0.5 };

export function buildNaiBody(c: Compiled, p: NaiParams, img2img?: Img2Img) {
  const seed = p.seed && p.seed > 0 ? p.seed : 1 + Math.floor(Math.random() * (2 ** 32 - 1));
  const useCoords = c.chars.some((ch) => ch.center);
  const caption = (base: string, pick: (ch: Compiled["chars"][number]) => string) => ({
    use_coords: useCoords,
    use_order: c.chars.length > 0,
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
      n_samples: 1, ucPreset: 3, qualityToggle: p.qualityToggle,
      sm: false, sm_dyn: false, dynamic_thresholding: false, cfg_rescale: p.cfgRescale,
      noise_schedule: p.noiseSchedule, legacy: false, legacy_v3_extend: false,
      add_original_image: false, seed, extra_noise_seed: seed,
      negative_prompt: c.uc, prompt: c.base,
      characterPrompts: c.chars.map((ch) => ({ prompt: ch.prompt, uc: ch.uc, center: ch.center ?? CENTER, enabled: true })),
      v4_prompt: caption(c.base, (ch) => ch.prompt),
      v4_negative_prompt: caption(c.uc, (ch) => ch.uc),
      ...(img2img && { image: img2img.image, strength: img2img.strength, noise: img2img.noise, color_correct: true }),
    },
  };
  return { body, seed };
}
