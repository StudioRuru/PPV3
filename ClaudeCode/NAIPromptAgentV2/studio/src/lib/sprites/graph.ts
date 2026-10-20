// Client-safe: pure graph builders for the Sprites studio (Qwen edit + Wan FLF clip).
import { DEFAULT_VIDEO_NEGATIVE, type VideoRecipe } from "../comfy/recipe";
import type { Surface } from "./core";

export type EditPreset = "noct" | "turbo";
type Sampler = { kind: "ksampler"; steps: number; cfg: number } | { kind: "sigmas"; sigmas: string };
export const EDIT_PRESETS: Record<EditPreset, { unet: string; clip: string; sampler: Sampler }> = {
  noct: { unet: "noctQAnime_v10_fp8.safetensors", clip: "qwen_image_2.1_text_encoder.safetensors", sampler: { kind: "ksampler", steps: 25, cfg: 3 } },
  // ponytail: turbo filenames are unverified (not on the pod yet); confirm in the §11 run
  turbo: {
    unet: "qwen_image_2.1_turbo_int8.safetensors", clip: "qwen3vl_8b.safetensors",
    sampler: { kind: "sigmas", sigmas: "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0" },
  },
};
export type EditJob = { preset: EditPreset; base: number /* comfy item id */; prompt: string; seed: number; width: 768; height: 1344; target: { takeId: number } };
export type SpriteJob = { surface: Surface; start: number; end: number /* item ids; equal for idle */; prompt: string; seconds: number; seed: number; target: { takeId: number } };

export const CLIP_NEGATIVE = DEFAULT_VIDEO_NEGATIVE;
const EDIT_NEGATIVE = "worst quality, low quality, lowres, blurry, bad anatomy, bad hands, watermark, text";

type Node = { class_type: string; inputs: Record<string, unknown> };

/** `image` is the pod-side name of the base frame. Qwen 2.1 edit: base image + vae go into the encoder, empty latent is sampled from. */
export function editGraph(j: EditJob, image: string): object {
  const p = EDIT_PRESETS[j.preset], s = p.sampler;
  const g: Record<string, Node> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: p.unet, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: p.clip, type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    img: { class_type: "LoadImage", inputs: { image } },
    enc: { class_type: "TextEncodeQwenImage21", inputs: { clip: ["clip", 0], prompt: j.prompt, negative_prompt: EDIT_NEGATIVE, resolution: 1024, "images.image_1": ["img", 0], vae: ["vae", 0] } },
    latent: { class_type: "EmptyLatentImage", inputs: { width: j.width, height: j.height, batch_size: 1 } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "studio-edit" } },
  } as Record<string, Node>;
  if (s.kind === "ksampler") {
    g.sampler = {
      class_type: "KSampler",
      inputs: { model: ["unet", 0], positive: ["enc", 0], negative: ["enc", 1], latent_image: ["latent", 0], seed: j.seed, steps: s.steps, cfg: s.cfg, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    };
  } else {
    g.noise = { class_type: "RandomNoise", inputs: { noise_seed: j.seed } };
    g.guider = { class_type: "CFGGuider", inputs: { model: ["unet", 0], positive: ["enc", 0], negative: ["enc", 1], cfg: 1 } };
    g.ksel = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    g.sigmas = { class_type: "ManualSigmas", inputs: { sigmas: s.sigmas } };
    g.sampler = { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["ksel", 0], sigmas: ["sigmas", 0], latent_image: ["latent", 0] } };
  }
  return g;
}

export function spriteRecipe(j: SpriteJob): VideoRecipe {
  const idle = j.start === j.end;
  return {
    mode: idle ? "loop" : "animate", prompt: j.prompt, negative: CLIP_NEGATIVE, loras: [], start: j.start, end: idle ? null : j.end,
    seconds: j.seconds, motion: "low", fps: 30, size: "480p", seed: j.seed, steps: 8, cfg: 1,
  };
}

/** Chat transitions are 0.75 s; idles and Stage clips 2.5 s. */
export const secondsFor = (surface: Surface, idle: boolean): number => (surface === "chat" && !idle ? 0.75 : 2.5);
