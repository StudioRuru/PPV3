// Client-safe: imported by components. No fs/sharp/db/env here.
import photoWf from "./workflows/photo.json";
import poseWf from "./workflows/pose-extract.json";
import i2vWf from "./workflows/video-i2v.json";
import t2vWf from "./workflows/video-t2v.json";

export type Lora = { name: string; strength: number };
export type PoseRef = { kind: "pose" | "depth" | "lineart"; image: string; strength: number };
export type PhotoRecipe = {
  mode: "photo"; model: string; prompt: string; negative: string; loras: Lora[]; pose: PoseRef | null;
  seed: number; steps: number; cfg: number; sampler: string; scheduler: string; width: number; height: number; hires: { scale: number; denoise: number } | null;
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
const missing = (what: string, name: string) => fail(`${what} “${name}” isn't on the GPU any more`);

function loras(v: unknown, have?: string[]): Lora[] {
  if (!Array.isArray(v) || v.length > 10) fail("loras must be a list of up to 10");
  return (v as unknown[]).map((x) => {
    const o = obj(x, "LoRA");
    const name = str(o.name, "LoRA name", 255);
    if (!name) fail("LoRA name is empty");
    if (have && !have.includes(name)) missing("LoRA", name);
    return { name, strength: num(o.strength, "LoRA strength", -2, 2) };
  });
}

/** Without `models` (GPU not ready yet) names aren't checked; drainQueue re-validates with them before submit. */
export function validatePhoto(r: unknown, models?: { checkpoints: string[]; loras: string[] }): PhotoRecipe {
  const o = obj(r, "recipe");
  const model = str(o.model, "model", 255);
  if (!model) fail("Pick a model");
  if (models && !models.checkpoints.includes(model)) missing("Model", model);
  let pose: PoseRef | null = null;
  if (o.pose != null) {
    const p = obj(o.pose, "pose");
    pose = { kind: oneOf(p.kind, "pose kind", ["pose", "depth", "lineart"] as const), image: file(p.image, "pose image"), strength: num(p.strength, "pose strength", 0, 2) };
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
    width: dim(o.width, "width"), height: dim(o.height, "height"), hires,
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

/** 16·s+1 frames rounded to 4k+1 (what Wan wants), s clamped 1–10. */
export function wanFrames(seconds: number): number {
  const s = Math.min(10, Math.max(1, seconds));
  return 4 * Math.round((16 * s) / 4) + 1;
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

export function photoGraph(r: PhotoRecipe): object {
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
  if (r.hires) {
    g.hires_up = { class_type: "LatentUpscaleBy", inputs: { samples: ["sampler", 0], upscale_method: "nearest-exact", scale_by: r.hires.scale } };
    g.hires_sampler = { class_type: "KSampler", inputs: { ...g.sampler.inputs, latent_image: ["hires_up", 0], denoise: r.hires.denoise } };
    g.decode.inputs.samples = ["hires_sampler", 0];
  }
  return g;
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
  const length = wanFrames(r.seconds);
  const [w, h] = (t2v ? T2V_SIZE : I2V_SIZE)[r.size];
  const [width, height] = frames.portrait ? [h, w] : [w, h];
  g.pos.inputs.text = [r.prompt.trim(), MOTION[r.motion]].filter(Boolean).join(", ");
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
    if (end) {
      g.end = { class_type: "LoadImage", inputs: { image: end } };
      g.i2v.class_type = "WanFirstLastFrameToVideo";
      g.i2v.inputs.end_image = ["end", 0];
    }
    const half = Math.ceil(r.steps / 2);
    Object.assign(g.ks_high.inputs, { noise_seed: r.seed, steps: r.steps, cfg: r.cfg, end_at_step: half });
    Object.assign(g.ks_low.inputs, { noise_seed: r.seed, steps: r.steps, cfg: r.cfg, start_at_step: half });
  }
  g.last.inputs.batch_index = length - 1;
  g.combine.inputs.frame_rate = r.fps;
  if (RIFE[r.fps] === 1) {
    delete g.rife;
    g.combine.inputs.images = ["decode", 0];
  } else g.rife.inputs.multiplier = RIFE[r.fps];
  return g;
}
