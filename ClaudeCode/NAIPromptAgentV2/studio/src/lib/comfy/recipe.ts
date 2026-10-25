// Client-safe: imported by components. No fs/sharp/db/env here.
import photoWf from "./workflows/photo.json";
import poseWf from "./workflows/pose-extract.json";
import type { EditJob, SpriteJob } from "../sprites/graph";
import i2vWf from "./workflows/video-i2v.json";
import t2vWf from "./workflows/video-t2v.json";

export type Lora = { name: string; strength: number; /** Trigger words the studio inserted into the prompt for this LoRA. */ words?: string[] };
export type PoseRef = { kind: "pose" | "depth" | "lineart"; image: string; strength: number };
export type PhotoRecipe = {
  mode: "photo"; model: string; prompt: string; negative: string; loras: Lora[]; pose: PoseRef | null;
  seed: number; steps: number; cfg: number; sampler: string; scheduler: string; width: number; height: number; hires: { scale: number; denoise: number } | null;
  /** Qwen only: BFS head swap. `base` is the body photo, `head` the face; both are image names in COMFY_DIR. */
  swap?: { base: string; head: string } | null;
  /** Re-render each detected face at higher resolution (Impact Pack FaceDetailer). */
  faceFix?: boolean;
};
export type VideoRecipe = {
  mode: "animate" | "t2v" | "extend" | "loop"; prompt: string; negative: string; loras: Lora[]; start: number | null /* item id */;
  end: number | null; seconds: number; motion: "low" | "medium" | "high"; fps: 16 | 30 | 60; size: "480p" | "720p"; seed: number; steps: number; cfg: number;
  /** An uploaded start frame in COMFY_DIR (ref-<ts>.png), used instead of a Library item. */
  startImage?: string;
};
/** A pose/depth/lineart extraction job; `result` is written when it finishes. */
export type PoseJob = { kind: PoseRef["kind"]; image: string; result?: { image: string; keypoints: unknown } };

export const DEFAULT_PHOTO_NEGATIVE = "worst quality, low quality, lowres, bad anatomy, bad hands, missing fingers, extra digits, jpeg artifacts, blurry, watermark, signature, text, username";
export const DEFAULT_VIDEO_NEGATIVE = "static, still image, blurry, low quality, worst quality, jpeg artifacts, deformed, distorted, extra limbs, bad hands, flickering, watermark, subtitles, text";
export const BFS_LORA = "bfs_head_v1.1_qwen_2.1.safetensors";
// The LoRA's trained trigger, verbatim; <image1> is the body, <image2> the head.
export const BFS_PROMPT = "head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. remove the head from <image1> completely and replace it with the head from <image2>, strictly preserving the hair, eye color, nose structure from <image2>. copy the direction of the eye, head rotation, micro expressions from <image1>, high quality, sharp details, 4k";
export const FACE_DETECTOR = "bbox/face_yolov8m.pt";
export const UNION_CONTROLNET = "diffusion_pytorch_model_promax.safetensors";
const UNION_TYPE: Record<PoseRef["kind"], string> = { pose: "openpose", depth: "depth", lineart: "canny/lineart/anime_lineart/mlsd" };
// ponytail: motion is a prompt phrase only; retune after the live run (Task 13)
const MOTION: Record<VideoRecipe["motion"], string> = { low: "subtle gentle movement", medium: "", high: "dynamic energetic movement" };
const RIFE: Record<VideoRecipe["fps"], number> = { 16: 1, 30: 2, 60: 4 };
const I2V_SIZE = { "480p": [832, 480], "720p": [1280, 720] } as const;
const T2V_SIZE = { "480p": [832, 480], "720p": [1280, 704] } as const; // TI2V 5B wants multiples of 32

// ---- validation
const fail = (m: string): never => { throw new Error(m); };
const obj = (v: unknown, what: string) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be an object`));
const num = (v: unknown, name: string, lo: number, hi: number, int = false): number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)) ? v : fail(`${name} must be ${int ? "a whole number" : "a number"} from ${lo} to ${hi}`);
const str = (v: unknown, name: string, max = 10_000): string => (typeof v === "string" && v.length <= max ? v : fail(`${name} must be text (up to ${max} characters)`));
const oneOf = <T>(v: unknown, name: string, opts: readonly T[]): T => (opts.includes(v as T) ? (v as T) : fail(`${name} must be one of ${opts.join(", ")}`));
const FILE = /^[\w-]+\.png$/;
const file = (v: unknown, name: string) => (typeof v === "string" && FILE.test(v) ? v : fail(`${name} must be an uploaded image name`));
const itemId = (v: unknown, name: string) => (v == null ? null : num(v, name, 1, Number.MAX_SAFE_INTEGER, true));
const seed = (v: unknown) => (v === -1 ? Math.floor(Math.random() * 2 ** 32) : num(v, "seed", 0, 0xffffffff, true));
const dim = (v: unknown, name: string) => (num(v, name, 512, 2048, true) % 64 ? fail(`${name} must be a multiple of 64`) : (v as number));
export type Family = "sdxl" | "qwen" | "krea2" | "moss";
export const family = (model: string): Family => (/krea/i.test(model) ? "krea2" : /moss/i.test(model) ? "moss" : /qwen|noctq/i.test(model) ? "qwen" : "sdxl");
export type LoraInfo = { family: Family | null; words: string[]; weight: number | null };
/** Unknown (no info) fits every model. */
export const fits = (info: LoraInfo | undefined, f: Family): boolean => !info || info.family === null || info.family === f;
export const isQwen = (model: string) => family(model) === "qwen";
/** Diffusion-only models: UNETLoader plus a separate text encoder and VAE. */
export const isDit = (model: string) => family(model) !== "sdxl";
const missing = (what: string, name: string) => fail(`${what} “${name}” isn't on the GPU any more`);

function loras(v: unknown, have?: string[]): Lora[] {
  if (!Array.isArray(v) || v.length > 10) fail("loras must be a list of up to 10");
  return (v as unknown[]).map((x) => {
    const o = obj(x, "LoRA");
    const name = str(o.name, "LoRA name", 255);
    if (!name) fail("LoRA name is empty");
    if (have && !have.includes(name)) missing("LoRA", name);
    const words = o.words == null ? undefined : Array.isArray(o.words) && o.words.length <= 10 ? o.words.map((w) => str(w, "LoRA trigger word", 80)) : fail("LoRA words must be a list of up to 10");
    return { name, strength: num(o.strength, "LoRA strength", -2, 2), ...(words ? { words } : {}) };
  });
}

/** Without `models` (GPU not ready yet) names aren't checked; drainQueue re-validates with them before submit. */
export function validatePhoto(r: unknown, models?: { checkpoints: string[]; loras: string[] }): PhotoRecipe {
  const o = obj(r, "recipe");
  const model = str(o.model, "model", 255);
  if (!model) fail("Pick a model");
  if (models && !models.checkpoints.includes(model)) missing("Model", model);
  const qwen = isQwen(model);
  if (isDit(model) && o.pose != null) fail("Pose isn't available for Qwen, Krea or MOSS models");
  let pose: PoseRef | null = null;
  if (o.pose != null) {
    const p = obj(o.pose, "pose");
    pose = { kind: oneOf(p.kind, "pose kind", ["pose", "depth", "lineart"] as const), image: file(p.image, "pose image"), strength: num(p.strength, "pose strength", 0, 2) };
  }
  let swap: PhotoRecipe["swap"] = null;
  if (o.swap != null) {
    if (!qwen) fail("Head swap needs a Qwen model");
    const w = obj(o.swap, "swap");
    swap = { base: file(w.base, "body image"), head: file(w.head, "head image") };
    if (models && !models.loras.includes(BFS_LORA)) missing("LoRA", BFS_LORA);
  }
  let hires: PhotoRecipe["hires"] = null;
  if (o.hires != null) {
    const h = obj(o.hires, "hires");
    hires = { scale: num(h.scale, "hires scale", 1, 2), denoise: num(h.denoise, "hires denoise", 0, 1) };
  }
  const name = /^[\w.+-]{1,64}$/;
  return {
    mode: "photo", model, prompt: str(o.prompt, "prompt"), negative: str(o.negative ?? "", "negative").trim() || DEFAULT_PHOTO_NEGATIVE,
    loras: loras(o.loras ?? [], models?.loras), pose, seed: seed(o.seed), steps: num(o.steps, "steps", 1, 150, true), cfg: num(o.cfg, "CFG", 0, 30),
    sampler: name.test(String(o.sampler)) ? String(o.sampler) : fail("sampler is invalid"),
    scheduler: name.test(String(o.scheduler)) ? String(o.scheduler) : fail("scheduler is invalid"),
    width: dim(o.width, "width"), height: dim(o.height, "height"), hires, ...(swap ? { swap } : {}), ...(o.faceFix === true ? { faceFix: true } : {}),
  };
}

export function validateVideo(r: unknown, models?: { loras: string[] }): VideoRecipe {
  const o = obj(r, "recipe");
  const mode = oneOf(o.mode, "mode", ["animate", "t2v", "extend", "loop"] as const);
  const prompt = str(o.prompt ?? "", "prompt");
  const start = itemId(o.start, "start");
  const startImage = o.startImage == null ? undefined : file(o.startImage, "start image");
  if (mode === "t2v" && !prompt.trim()) fail("Text to video needs a prompt");
  if (mode !== "t2v" && start === null && !startImage) fail("Pick a start frame");
  const v: VideoRecipe = {
    mode, prompt, negative: str(o.negative ?? "", "negative").trim() || DEFAULT_VIDEO_NEGATIVE, loras: loras(o.loras ?? [], models?.loras),
    start, end: itemId(o.end, "end"), seconds: num(o.seconds, "seconds", 1, 10), motion: oneOf(o.motion, "motion", ["low", "medium", "high"] as const),
    fps: oneOf(o.fps, "fps", [16, 30, 60] as const), size: oneOf(o.size, "size", ["480p", "720p"] as const),
    seed: seed(o.seed), steps: num(o.steps, "steps", 1, 150, true), cfg: num(o.cfg, "CFG", 0, 30),
  };
  if (startImage) v.startImage = startImage;
  return v;
}

export function validatePose(r: unknown): PoseJob {
  const o = obj(r, "recipe");
  return { kind: oneOf(o.kind, "kind", ["pose", "depth", "lineart"] as const), image: file(o.image, "image") };
}

/** 16·s+1 frames rounded to 4k+1 (what Wan wants), s clamped 0.5–10. */
export function wanFrames(seconds: number): number {
  const s = Math.min(10, Math.max(0.5, seconds));
  return 4 * Math.round((16 * s) / 4) + 1;
}

/** Splits the prompt by sentence across `n` chained segments: Wan manages about one action per 5 s segment. */
export function beats(prompt: string, n: number): string[] {
  const s = prompt.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (s.length <= 1) return Array(n).fill(prompt.trim());
  return Array.from({ length: n }, (_, k) => {
    const a = Math.floor((k * s.length) / n);
    return s.slice(a, Math.max(a + 1, Math.floor(((k + 1) * s.length) / n))).join(" ");
  });
}

export function validateEdit(r: unknown): EditJob {
  const o = obj(r, "recipe");
  return {
    preset: oneOf(o.preset, "preset", ["pose"] as const), base: num(o.base, "base", 1, Number.MAX_SAFE_INTEGER, true), prompt: str(o.prompt, "prompt"),
    seed: seed(o.seed), width: 768, height: 1344, target: { takeId: num(obj(o.target, "target").takeId, "take", 1, Number.MAX_SAFE_INTEGER, true) },
  };
}

export function validateSprite(r: unknown): SpriteJob {
  const o = obj(r, "recipe"), id = (v: unknown, n: string) => num(v, n, 1, Number.MAX_SAFE_INTEGER, true);
  return {
    surface: oneOf(o.surface, "surface", ["chat", "stage"] as const), start: id(o.start, "start"), end: id(o.end, "end"), prompt: str(o.prompt ?? "", "prompt"),
    seconds: num(o.seconds, "seconds", 0.5, 3), seed: seed(o.seed), target: { takeId: id(obj(o.target, "target").takeId, "take") },
  };
}

// ---- graph fillers
type Link = [string, number];
type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;
const load = (wf: object): Graph => {
  const g = structuredClone(wf) as Record<string, unknown>;
  delete g._ids;
  return g as Graph;
};

// Encoder/VAE per diffusion-only family, from the Comfy-Org templates (Krea 2 turbo, MOSS-Image t2i).
// EmptyLatentImage is converted by KSampler's fix_empty_latent_channels.
export const DIT: Record<Exclude<Family, "sdxl">, { clip: string; type: string; vae: string; latent: string }> = {
  qwen: { clip: "qwen_image_2.1_text_encoder.safetensors", type: "qwen_image", vae: "qwen_image_2.1_vae_bf16.safetensors", latent: "EmptyLatentImage" },
  krea2: { clip: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2", vae: "qwen_image_vae.safetensors", latent: "EmptyLatentImage" },
  moss: { clip: "qwen3.5_9b_int8_convrot.safetensors", type: "moss_image", vae: "flux2-vae.safetensors", latent: "EmptyFlux2LatentImage" },
};

// Qwen Image 2.1, Krea 2, MOSS: UNET + family encoder. LoRAs are model-only: these text encoders take none.
function ditGraph(r: PhotoRecipe): Graph {
  const fam = family(r.model) as Exclude<Family, "sdxl">, f = DIT[fam];
  let model: Link = ["unet", 0];
  const [pos, neg]: Link[] = fam === "qwen" ? [["enc", 0], ["enc", 1]] : [["pos", 0], ["neg", 0]];
  const g: Graph = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: r.model, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: f.clip, type: f.type, device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: f.vae } },
    ...(fam === "qwen"
      ? { enc: { class_type: "TextEncodeQwenImage21", inputs: { clip: ["clip", 0], prompt: r.prompt, negative_prompt: r.negative, resolution: 1024 } } }
      : { pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: r.prompt } }, neg: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: r.negative } } }),
    latent: { class_type: f.latent, inputs: { width: r.width, height: r.height, batch_size: 1 } },
    sampler: {
      class_type: "KSampler",
      inputs: { model, positive: pos, negative: neg, latent_image: ["latent", 0], seed: r.seed, steps: r.steps, cfg: r.cfg, sampler_name: r.sampler, scheduler: r.scheduler, denoise: 1 },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "studio" } },
  };
  r.loras.forEach((l, i) => {
    const id = `lora${i + 1}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: l.name, strength_model: l.strength } };
    model = [id, 0];
  });
  g.sampler.inputs.model = model;
  if (r.swap) swap(g, r.swap, r.prompt);
  face(g, r, ["clip", 0], ["vae", 0], pos, neg);
  return hires(g, r);
}

// Head swap: body + head go into the encoder (autogrow keys must be "images.image_N"); its latent is sized to the body.
function swap(g: Graph, w: { base: string; head: string }, prompt: string): void {
  g.body = { class_type: "LoadImage", inputs: { image: w.base } };
  g.head = { class_type: "LoadImage", inputs: { image: w.head } };
  Object.assign(g.enc.inputs, { prompt: [BFS_PROMPT, prompt.trim()].filter(Boolean).join(", "), "images.image_1": ["body", 0], "images.image_2": ["head", 0], vae: ["vae", 0] });
  delete g.latent;
  g.sampler.inputs.latent_image = ["enc", 2];
  let id = Object.keys(g).find((k) => k.startsWith("lora") && g[k].inputs.lora_name === BFS_LORA);
  if (!id) {
    id = "lora_bfs";
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: g.sampler.inputs.model, lora_name: BFS_LORA, strength_model: 1 } };
    g.sampler.inputs.model = [id, 0];
  }
}

// Detect faces on the decoded image, re-sample each crop with the same model and prompt, paste back.
// Plain prompt conditioning (not ControlNet's), since that hint is for the whole frame.
function face(g: Graph, r: PhotoRecipe, clip: Link, vae: Link, positive: Link, negative: Link): void {
  if (!r.faceFix) return;
  g.face_det = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: FACE_DETECTOR } };
  g.face = {
    class_type: "FaceDetailer",
    inputs: {
      image: ["decode", 0], model: g.sampler.inputs.model, clip, vae, positive, negative, bbox_detector: ["face_det", 0],
      guide_size: isDit(r.model) ? 1024 : 512, guide_size_for: true, max_size: isDit(r.model) ? 1536 : 1024,
      seed: r.seed, steps: r.steps, cfg: r.cfg, sampler_name: r.sampler, scheduler: r.scheduler, denoise: 0.4,
      feather: 5, noise_mask: true, force_inpaint: true, bbox_threshold: 0.5, bbox_dilation: 10, bbox_crop_factor: 3,
      sam_detection_hint: "center-1", sam_dilation: 0, sam_threshold: 0.93, sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: "False",
      drop_size: 10, wildcard: "", cycle: 1,
    },
  };
  g.save.inputs.images = ["face", 0];
}

function hires(g: Graph, r: PhotoRecipe): Graph {
  if (!r.hires) return g;
  g.hires_up = { class_type: "LatentUpscaleBy", inputs: { samples: ["sampler", 0], upscale_method: "nearest-exact", scale_by: r.hires.scale } };
  g.hires_sampler = { class_type: "KSampler", inputs: { ...g.sampler.inputs, latent_image: ["hires_up", 0], denoise: r.hires.denoise } };
  g.decode.inputs.samples = ["hires_sampler", 0];
  return g;
}

export function photoGraph(r: PhotoRecipe): object {
  if (isDit(r.model)) return ditGraph(r);
  const g = load(photoWf);
  g.ckpt.inputs.ckpt_name = r.model;
  let model: Link = ["ckpt", 0], clip: Link = ["ckpt", 1];
  r.loras.forEach((l, i) => {
    const id = `lora${i + 1}`;
    g[id] = { class_type: "LoraLoader", inputs: { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength } };
    model = [id, 0];
    clip = [id, 1];
  });
  Object.assign(g.pos.inputs, { text: r.prompt, clip });
  Object.assign(g.neg.inputs, { text: r.negative, clip });
  Object.assign(g.latent.inputs, { width: r.width, height: r.height });
  Object.assign(g.sampler.inputs, { model, seed: r.seed, steps: r.steps, cfg: r.cfg, sampler_name: r.sampler, scheduler: r.scheduler, denoise: 1 });
  if (r.pose) {
    g.cn_load = { class_type: "ControlNetLoader", inputs: { control_net_name: UNION_CONTROLNET } };
    g.cn_type = { class_type: "SetUnionControlNetType", inputs: { control_net: ["cn_load", 0], type: UNION_TYPE[r.pose.kind] } };
    g.cn_image = { class_type: "LoadImage", inputs: { image: r.pose.image } };
    g.cn_apply = {
      class_type: "ControlNetApplyAdvanced",
      inputs: { positive: ["pos", 0], negative: ["neg", 0], control_net: ["cn_type", 0], image: ["cn_image", 0], strength: r.pose.strength, start_percent: 0, end_percent: 1, vae: ["ckpt", 2] },
    };
    Object.assign(g.sampler.inputs, { positive: ["cn_apply", 0], negative: ["cn_apply", 1] });
  }
  face(g, r, clip, ["ckpt", 2], ["pos", 0], ["neg", 0]);
  return hires(g, r);
}

export function poseGraph(image: string, kind: PoseRef["kind"]): object {
  const g = load(poseWf);
  g.image.inputs.image = image;
  if (kind === "depth") g.pose = { class_type: "DepthAnythingV2Preprocessor", inputs: { image: ["image", 0], ckpt_name: "depth_anything_v2_vits.pth", resolution: 1024 } };
  if (kind === "lineart") g.pose = { class_type: "LineArtPreprocessor", inputs: { image: ["image", 0], coarse: "disable", resolution: 1024 } };
  return g;
}

/** `frames` holds pod-side image names; `portrait` swaps width/height to match the start frame. */
export function videoGraph(r: VideoRecipe, frames: { start?: string; end?: string; portrait?: boolean }): object {
  const t2v = r.mode === "t2v";
  const g = load(t2v ? t2vWf : i2vWf);
  // Wan blurs past its 81-frame training window, so long i2v clips are chained ≤5 s segments.
  const segs = t2v ? 1 : Math.ceil(r.seconds / 5);
  const length = wanFrames(r.seconds / segs);
  const [w, h] = (t2v ? T2V_SIZE : I2V_SIZE)[r.size];
  const [width, height] = frames.portrait ? [h, w] : [w, h];
  const text = beats(r.prompt, segs).map((b) => [b, MOTION[r.motion]].filter(Boolean).join(", "));
  g.pos.inputs.text = text[0];
  g.neg.inputs.text = r.negative;
  // ponytail: each LoRA goes on every Wan model in the graph; split high/low LoRA pairs if quality needs it
  const chain = (unet: string, shift: string) => {
    let model: Link = [unet, 0];
    r.loras.forEach((l, i) => {
      const id = `${shift}_lora${i + 1}`;
      g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: l.name, strength_model: l.strength } };
      model = [id, 0];
    });
    g[shift].inputs.model = model;
  };
  if (t2v) {
    chain("unet", "shift");
    Object.assign(g.latent.inputs, { width, height, length });
    Object.assign(g.sampler.inputs, { seed: r.seed, steps: r.steps, cfg: r.cfg });
  } else {
    chain("unet_high", "shift_high");
    chain("unet_low", "shift_low");
    const start = frames.start ?? fail("A start frame is needed");
    const end = r.mode === "loop" ? start : r.mode === "animate" ? frames.end : undefined;
    g.start.inputs.image = start;
    Object.assign(g.i2v.inputs, { width, height, length });
    const half = Math.ceil(r.steps / 2);
    Object.assign(g.ks_high.inputs, { noise_seed: r.seed, steps: r.steps, cfg: r.cfg, end_at_step: half });
    Object.assign(g.ks_low.inputs, { noise_seed: r.seed, steps: r.steps, cfg: r.cfg, start_at_step: half });
    let i2v = "i2v", joined: Link = ["decode", 0], decoded = "decode";
    for (let k = 2; k <= segs; k++) {
      const c = (id: string) => structuredClone(g[id]);
      g[`tail${k}`] = { class_type: "ImageFromBatch", inputs: { image: [decoded, 0], batch_index: length - 1, length: 1 } };
      g[`pos${k}`] = { ...c("pos"), inputs: { ...c("pos").inputs, text: text[k - 1] } };
      g[`i2v${k}`] = { ...c("i2v"), inputs: { ...c("i2v").inputs, positive: [`pos${k}`, 0], start_image: [`tail${k}`, 0] } };
      g[`ks_high${k}`] = c("ks_high");
      Object.assign(g[`ks_high${k}`].inputs, { positive: [`i2v${k}`, 0], negative: [`i2v${k}`, 1], latent_image: [`i2v${k}`, 2], noise_seed: (r.seed + k - 1) % 2 ** 32 });
      g[`ks_low${k}`] = c("ks_low");
      Object.assign(g[`ks_low${k}`].inputs, { positive: [`i2v${k}`, 0], negative: [`i2v${k}`, 1], latent_image: [`ks_high${k}`, 0], noise_seed: (r.seed + k - 1) % 2 ** 32 });
      g[`decode${k}`] = { class_type: "VAEDecode", inputs: { samples: [`ks_low${k}`, 0], vae: ["vae", 0] } };
      // frame 0 repeats the previous segment's last frame: drop it at the seam
      g[`rest${k}`] = { class_type: "ImageFromBatch", inputs: { image: [`decode${k}`, 0], batch_index: 1, length: length - 1 } };
      g[`join${k}`] = { class_type: "ImageBatch", inputs: { image1: joined, image2: [`rest${k}`, 0] } };
      [i2v, decoded, joined] = [`i2v${k}`, `decode${k}`, [`join${k}`, 0]];
    }
    if (end) {
      g.end = { class_type: "LoadImage", inputs: { image: end } };
      g[i2v].class_type = "WanFirstLastFrameToVideo";
      g[i2v].inputs.end_image = ["end", 0];
    }
    g.rife.inputs.frames = joined;
    g.last.inputs.image = joined;
  }
  g.last.inputs.batch_index = length + (segs - 1) * (length - 1) - 1;
  g.combine.inputs.frame_rate = r.fps;
  if (RIFE[r.fps] === 1) {
    g.combine.inputs.images = g.rife.inputs.frames;
    delete g.rife;
  } else g.rife.inputs.multiplier = RIFE[r.fps];
  return g;
}
