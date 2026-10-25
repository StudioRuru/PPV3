// Client-safe: pure graph builders for the Sprites studio (MOSS pose + Wan FLF clip).
import { DEFAULT_VIDEO_NEGATIVE, DIT, type VideoRecipe } from "../comfy/recipe";
import { photoTune } from "../comfy/photo-draft";
import { SPRITE_LORAS } from "./loras";
import type { Surface } from "./core";

export type EditPreset = "pose";
const MOSS_UNET = "pornmasterMoss_v1.safetensors"; // POSE_FAMILY = moss (train.ts)
export const POSE = { unet: MOSS_UNET, ...DIT.moss, ...photoTune(MOSS_UNET), denoise: 0.85 };
export type EditJob = { preset: EditPreset; base: number /* comfy item id */; prompt: string; seed: number; width: 768; height: 1344; target: { takeId: number } };
export type SpriteJob = { surface: Surface; start: number; end: number /* item ids; equal for idle */; prompt: string; seconds: number; seed: number; target: { takeId: number } };

export const CLIP_NEGATIVE = DEFAULT_VIDEO_NEGATIVE;
const EDIT_NEGATIVE = "worst quality, low quality, lowres, blurry, bad anatomy, bad hands, watermark, text";

type Node = { class_type: string; inputs: Record<string, unknown> };

/** `image` is the pod-side name of the base frame. MOSS ignores reference_latents, so the pose is img2img from the base. */
export function editGraph(j: EditJob, image: string): object {
  const g: Record<string, Node> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: POSE.unet, weight_dtype: "default" } },
    lora: { class_type: "LoraLoaderModelOnly", inputs: { model: ["unet", 0], lora_name: SPRITE_LORAS.image.name, strength_model: SPRITE_LORAS.image.strength } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: POSE.clip, type: POSE.type, device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: POSE.vae } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: `${SPRITE_LORAS.trigger}, ${j.prompt}` } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: EDIT_NEGATIVE } },
    img: { class_type: "LoadImage", inputs: { image } },
    scale: { class_type: "ImageScale", inputs: { image: ["img", 0], upscale_method: "lanczos", width: j.width, height: j.height, crop: "disabled" } },
    latent: { class_type: "VAEEncode", inputs: { pixels: ["scale", 0], vae: ["vae", 0] } },
    sampler: {
      class_type: "KSampler",
      // ponytail: tune at G7; 1.0 = pure t2i
      inputs: { model: ["lora", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["latent", 0], seed: j.seed, steps: POSE.steps, cfg: POSE.cfg, sampler_name: POSE.sampler, scheduler: POSE.scheduler, denoise: POSE.denoise },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "studio-edit" } },
  };
  return g;
}

export function spriteRecipe(j: SpriteJob): VideoRecipe {
  const idle = j.start === j.end;
  return {
    mode: idle ? "loop" : "animate", prompt: j.prompt, negative: CLIP_NEGATIVE, loras: SPRITE_LORAS.wan, start: j.start, end: idle ? null : j.end,
    seconds: j.seconds, motion: "low", fps: 30, size: "720p", seed: j.seed, steps: 8, cfg: 1,
  };
}

/** Chat transitions are 0.75 s; idles and Stage clips 2.5 s. */
export const secondsFor = (surface: Surface, idle: boolean): number => (surface === "chat" && !idle ? 0.75 : 2.5);
