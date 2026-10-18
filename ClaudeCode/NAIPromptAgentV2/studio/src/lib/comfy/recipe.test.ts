import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoGraph, poseGraph, videoGraph, validatePhoto, validateVideo, wanFrames, isQwen,
  DEFAULT_PHOTO_NEGATIVE, DEFAULT_VIDEO_NEGATIVE, type PhotoRecipe, type VideoRecipe,
} from "./recipe";
import { estimate } from "./estimate";

type G = Record<string, { class_type: string; inputs: Record<string, any> }>;
const byClass = (g: G, c: string) => Object.entries(g).filter(([, n]) => n.class_type === c);
const one = (g: G, c: string) => { const l = byClass(g, c); assert.equal(l.length, 1, c); return l[0]; };

const photo: PhotoRecipe = {
  mode: "photo", model: "waiIllustriousSDXL_v170.safetensors", prompt: "1girl, smile", negative: "", loras: [], pose: null,
  seed: 42, steps: 28, cfg: 6, sampler: "euler_ancestral", scheduler: "normal", width: 832, height: 1216, hires: null,
};
const video: VideoRecipe = {
  mode: "animate", prompt: "she waves", negative: "", loras: [], start: 1, end: null, seconds: 5, motion: "medium",
  fps: 16, size: "480p", seed: 7, steps: 20, cfg: 3.5,
};
const models = { checkpoints: ["waiIllustriousSDXL_v170.safetensors"], loras: ["a.safetensors", "b.safetensors"] };

test("photoGraph chains two LoRAs in order with their strengths", () => {
  const g = photoGraph({ ...photo, loras: [{ name: "a.safetensors", strength: 0.8 }, { name: "b.safetensors", strength: -0.5 }] }) as G;
  assert.equal("_ids" in g, false);
  const [samplerId, sampler] = one(g, "KSampler");
  assert.ok(samplerId);
  const second = g[sampler.inputs.model[0]];
  assert.equal(second.class_type, "LoraLoader");
  assert.equal(second.inputs.lora_name, "b.safetensors");
  assert.equal(second.inputs.strength_model, -0.5);
  assert.equal(second.inputs.strength_clip, -0.5);
  const first = g[second.inputs.model[0]];
  assert.equal(first.inputs.lora_name, "a.safetensors");
  assert.equal(first.inputs.strength_model, 0.8);
  assert.equal(g[first.inputs.model[0]].class_type, "CheckpointLoaderSimple");
  assert.equal(g[first.inputs.model[0]].inputs.ckpt_name, "waiIllustriousSDXL_v170.safetensors");
  // both prompts read the clip from the last LoRA
  for (const [, n] of byClass(g, "CLIPTextEncode")) assert.equal(g[n.inputs.clip[0]], second);
});

test("photoGraph with a pose inserts union ControlNet with the right type and strength", () => {
  const types = { pose: "openpose", depth: "depth", lineart: "canny/lineart/anime_lineart/mlsd" } as const;
  for (const kind of ["pose", "depth", "lineart"] as const) {
    const g = photoGraph({ ...photo, pose: { kind, image: "pose-1.png", strength: 0.7 } }) as G;
    const [loadId, load] = one(g, "ControlNetLoader");
    assert.equal(load.inputs.control_net_name, "diffusion_pytorch_model_promax.safetensors");
    const [typeId, type] = one(g, "SetUnionControlNetType");
    assert.deepEqual(type.inputs.control_net, [loadId, 0]);
    assert.equal(type.inputs.type, types[kind]);
    const [applyId, apply] = one(g, "ControlNetApplyAdvanced");
    assert.deepEqual(apply.inputs.control_net, [typeId, 0]);
    assert.equal(apply.inputs.strength, 0.7);
    assert.equal(g[apply.inputs.image[0]].inputs.image, "pose-1.png");
    const [, sampler] = one(g, "KSampler");
    assert.deepEqual(sampler.inputs.positive, [applyId, 0]);
    assert.deepEqual(sampler.inputs.negative, [applyId, 1]);
  }
});

test("hires adds a second sampler at the set denoise", () => {
  const g = photoGraph({ ...photo, hires: { scale: 1.5, denoise: 0.45 } }) as G;
  const samplers = byClass(g, "KSampler");
  assert.equal(samplers.length, 2);
  const [, up] = one(g, "LatentUpscaleBy");
  assert.equal(up.inputs.scale_by, 1.5);
  const second = samplers.find(([, n]) => g[n.inputs.latent_image[0]] === up)!;
  assert.ok(second, "a sampler reads the upscaled latent");
  assert.equal(second[1].inputs.denoise, 0.45);
  assert.equal(second[1].inputs.seed, 42);
  const [, decode] = one(g, "VAEDecode");
  assert.deepEqual(decode.inputs.samples, [second[0], 0]);
  // without hires: one sampler, full denoise
  const plain = photoGraph(photo) as G;
  assert.equal(byClass(plain, "KSampler").length, 1);
  assert.equal(one(plain, "KSampler")[1].inputs.denoise, 1);
});

test("validatePhoto rejects a LoRA not on the GPU, naming it", () => {
  assert.throws(() => validatePhoto({ ...photo, loras: [{ name: "gone.safetensors", strength: 1 }] }, models), /LoRA “gone\.safetensors” isn't on the GPU any more/);
  assert.throws(() => validatePhoto({ ...photo, model: "old.safetensors" }, models), /“old\.safetensors”/);
});

test("validatePhoto applies limits, the default negative and a random seed for -1", () => {
  const r = validatePhoto({ ...photo, seed: -1 }, models);
  assert.ok(Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 0xffffffff);
  assert.equal(r.negative, DEFAULT_PHOTO_NEGATIVE);
  assert.throws(() => validatePhoto({ ...photo, width: 800 }, models), /width/);
  assert.throws(() => validatePhoto({ ...photo, height: 2112 }, models), /height/);
  assert.throws(() => validatePhoto({ ...photo, steps: 151 }, models), /steps/);
  assert.throws(() => validatePhoto({ ...photo, cfg: 31 }, models), /CFG/);
  assert.throws(() => validatePhoto({ ...photo, loras: [{ name: "a.safetensors", strength: 2.5 }] }, models), /strength/);
  assert.equal(validatePhoto({ ...photo, width: 2048, height: 512, steps: 150, cfg: 30 }, models).width, 2048);
  // no model list yet (GPU cold): shape is still checked, names are not
  assert.equal(validatePhoto({ ...photo, model: "anything.safetensors" }).model, "anything.safetensors");
});

test("default negatives carry no age words", () => {
  for (const n of [DEFAULT_PHOTO_NEGATIVE, DEFAULT_VIDEO_NEGATIVE])
    assert.doesNotMatch(n, /child|kid|loli|shota|young|old|teen|adult|mature|aged|minor|baby/i);
});

test("validateVideo checks modes, frames and LoRAs", () => {
  assert.equal(validateVideo({ ...video, seed: -1 }, { loras: [] }).seed >= 0, true);
  assert.throws(() => validateVideo({ ...video, loras: [{ name: "x.safetensors", strength: 1 }] }, { loras: [] }), /LoRA “x\.safetensors”/);
  assert.throws(() => validateVideo({ ...video, start: null }, { loras: [] }), /start/);
  assert.equal(validateVideo({ ...video, mode: "t2v", start: null }, { loras: [] }).mode, "t2v");
  assert.equal(validateVideo({ ...video, start: null, startImage: "ref-1.png" }, { loras: [] }).startImage, "ref-1.png");
  assert.throws(() => validateVideo({ ...video, fps: 24 }, { loras: [] }), /fps/);
  assert.throws(() => validateVideo({ ...video, seconds: 11 }, { loras: [] }), /seconds/);
});

test("loop sets end = start; 60 fps sets RIFE ×4", () => {
  const g = videoGraph({ ...video, mode: "loop", fps: 60 }, { start: "s.png" }) as G;
  const [, flf] = one(g, "WanFirstLastFrameToVideo");
  assert.equal(byClass(g, "WanImageToVideo").length, 0);
  assert.equal(g[flf.inputs.start_image[0]].inputs.image, "s.png");
  assert.equal(g[flf.inputs.end_image[0]].inputs.image, "s.png");
  assert.equal(flf.inputs.length, 81);
  const [rifeId, rife] = one(g, "RIFE VFI");
  assert.equal(rife.inputs.multiplier, 4);
  const [, combine] = one(g, "VHS_VideoCombine");
  assert.equal(combine.inputs.frame_rate, 60);
  assert.equal(combine.inputs.format, "video/h264-mp4");
  assert.deepEqual(combine.inputs.images, [rifeId, 0]);
  // two-pass A14B: high noise then low noise, split at half the steps
  const ks = byClass(g, "KSamplerAdvanced").map(([, n]) => n);
  assert.equal(ks.length, 2);
  const [hi, lo] = ks[0].inputs.start_at_step === 0 ? ks : [ks[1], ks[0]];
  assert.equal(hi.inputs.end_at_step, 10);
  assert.equal(lo.inputs.start_at_step, 10);
  assert.equal(one(g, "ImageFromBatch")[1].inputs.batch_index, 80);
});

test("16 fps bypasses RIFE; 30 fps doubles; animate without end uses WanImageToVideo; motion phrase", () => {
  const g16 = videoGraph({ ...video, motion: "high" }, { start: "s.png" }) as G;
  assert.equal(byClass(g16, "RIFE VFI").length, 0);
  const [decodeId] = one(g16, "VAEDecode");
  assert.deepEqual(one(g16, "VHS_VideoCombine")[1].inputs.images, [decodeId, 0]);
  assert.equal(byClass(g16, "WanImageToVideo").length, 1);
  assert.ok(byClass(g16, "CLIPTextEncode").some(([, n]) => n.inputs.text === "she waves, dynamic energetic movement"));
  const g30 = videoGraph({ ...video, fps: 30, end: 2 }, { start: "s.png", end: "e.png" }) as G;
  assert.equal(one(g30, "RIFE VFI")[1].inputs.multiplier, 2);
  assert.equal(g30[one(g30, "WanFirstLastFrameToVideo")[1].inputs.end_image[0]].inputs.image, "e.png");
});

test("t2v uses the TI2V 5B workflow and portrait swaps the size", () => {
  const g = videoGraph({ ...video, mode: "t2v", start: null, size: "720p" }, {}) as G;
  assert.equal(one(g, "UNETLoader")[1].inputs.unet_name, "wan2.2_ti2v_5B_fp16.safetensors");
  assert.equal(one(g, "VAELoader")[1].inputs.vae_name, "wan2.2_vae.safetensors");
  assert.equal(byClass(g, "LoadImage").length, 0);
  const i2v = videoGraph(video, { start: "s.png", portrait: true }) as G;
  const [, wan] = one(i2v, "WanImageToVideo");
  assert.equal(wan.inputs.width < wan.inputs.height, true);
  assert.equal(one(i2v, "VAELoader")[1].inputs.vae_name, "wan_2.1_vae.safetensors");
});

test("poseGraph picks the preprocessor for the kind", () => {
  const g = poseGraph("ref-1.png", "pose") as G;
  assert.equal(one(g, "LoadImage")[1].inputs.image, "ref-1.png");
  assert.equal(byClass(g, "DWPreprocessor").length, 1);
  assert.equal(byClass(poseGraph("r.png", "depth") as G, "DepthAnythingV2Preprocessor").length, 1);
  assert.equal(byClass(poseGraph("r.png", "lineart") as G, "LineArtPreprocessor").length, 1);
});

test("wanFrames(5) = 81", () => {
  assert.equal(wanFrames(5), 81);
  assert.equal(wanFrames(0), 17);
  assert.equal(wanFrames(99), 161);
  assert.equal((wanFrames(2.6) - 1) % 4, 0);
});

test("estimate scales with frames and card price", () => {
  const five = estimate(video, "L40", 1);
  const ten = estimate({ ...video, seconds: 10 }, "L40", 1);
  assert.ok(ten.seconds > five.seconds);
  const pricier = estimate(video, "L40", 2);
  assert.equal(pricier.seconds, five.seconds);
  assert.ok(Math.abs(pricier.usd - 2 * five.usd) < 1e-9);
  assert.ok(Math.abs(five.usd - five.seconds / 3600) < 1e-9);
  assert.ok(estimate(video, "H100-80G-PCIe", 1).seconds < five.seconds);
  assert.ok(estimate({ ...photo, steps: 56 }, "L40", 1).seconds > estimate(photo, "L40", 1).seconds);
  assert.ok(estimate({ ...photo, model: "noctQAnime_v10_fp8.safetensors", steps: 25 }, "L40", 1).seconds > 3 * estimate(photo, "L40", 1).seconds);
});

const qwen: PhotoRecipe = { ...photo, model: "noctQAnime_v10_fp8.safetensors", steps: 25, cfg: 3, sampler: "euler", scheduler: "simple" };

test("Qwen models build a UNETLoader + TextEncodeQwenImage21 graph, no checkpoint loader", () => {
  assert.ok(isQwen("noctQRealism_v40Base_fp8.safetensors") && isQwen("qwen_image_x.safetensors") && !isQwen(photo.model));
  const g = photoGraph(qwen) as G;
  assert.equal(byClass(g, "CheckpointLoaderSimple").length, 0);
  assert.equal(one(g, "UNETLoader")[1].inputs.unet_name, qwen.model);
  assert.deepEqual(one(g, "CLIPLoader")[1].inputs, { clip_name: "qwen_image_2.1_text_encoder.safetensors", type: "qwen_image", device: "default" });
  const [enc, e] = one(g, "TextEncodeQwenImage21");
  assert.deepEqual([e.inputs.prompt, e.inputs.negative_prompt, e.inputs.resolution, e.inputs.vae], [qwen.prompt, qwen.negative, 1024, undefined]);
  const s = g.sampler.inputs;
  assert.deepEqual([s.positive, s.negative, s.latent_image, s.steps, s.cfg, s.sampler_name, s.scheduler, s.denoise], [[enc, 0], [enc, 1], ["latent", 0], 25, 3, "euler", "simple", 1]);
  assert.deepEqual([g.latent.inputs.width, g.latent.inputs.height], [832, 1216]);
  assert.equal(g.save.class_type, "SaveImage");
  assert.deepEqual(g.decode.inputs.samples, ["sampler", 0]);
  const h = photoGraph({ ...qwen, hires: { scale: 1.5, denoise: 0.4 } }) as G;
  assert.equal(byClass(h, "KSampler").length, 2);
  assert.deepEqual(h.decode.inputs.samples, ["hires_sampler", 0]);
});

test("validatePhoto refuses pose and LoRAs on a Qwen model", () => {
  const base = { ...qwen, seed: 1 };
  assert.throws(() => validatePhoto({ ...base, pose: { kind: "pose", image: "pose.png", strength: 1 } }), /Pose isn't available for Qwen models/);
  assert.throws(() => validatePhoto({ ...base, loras: [{ name: "x", strength: 1 }] }), /LoRAs aren't available for Qwen models/);
  assert.equal(validatePhoto(base).model, qwen.model);
});
