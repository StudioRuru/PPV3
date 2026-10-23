import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoGraph, poseGraph, videoGraph, beats, validatePhoto, validateVideo, wanFrames, isQwen, family, BFS_LORA, BFS_PROMPT, FACE_DETECTOR,
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

test("validatePhoto keeps LoRA trigger words and rejects too many or too long", () => {
  const r = validatePhoto({ ...photo, loras: [{ name: "a.safetensors", strength: 0.8, words: ["x"] }] }, models);
  assert.deepEqual(r.loras, [{ name: "a.safetensors", strength: 0.8, words: ["x"] }]);
  assert.throws(() => validatePhoto({ ...photo, loras: [{ name: "a.safetensors", strength: 1, words: Array(11).fill("x") }] }, models), /words/);
  assert.throws(() => validatePhoto({ ...photo, loras: [{ name: "a.safetensors", strength: 1, words: ["x".repeat(81)] }] }, models), /up to 80 characters/);
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

test("i2v past 5 s chains ≤81-frame segments, each starting on the last frame of the one before", () => {
  const g = videoGraph({ ...video, seconds: 10, end: 2, fps: 30 }, { start: "s.png", end: "e.png" }) as G;
  const segs = [...byClass(g, "WanImageToVideo"), ...byClass(g, "WanFirstLastFrameToVideo")];
  assert.equal(segs.length, 2);
  assert.ok(segs.every(([, n]) => n.inputs.length === 81)); // never past Wan's training window
  const [, last] = one(g, "WanFirstLastFrameToVideo"); // the end frame only pins the final segment
  assert.equal(g[last.inputs.end_image[0]].inputs.image, "e.png");
  const tail = g[last.inputs.start_image[0]];
  assert.equal(tail.class_type, "ImageFromBatch");
  assert.equal(tail.inputs.batch_index, 80);
  assert.equal(byClass(g, "KSamplerAdvanced").length, 4);
  const [joinId] = one(g, "ImageBatch");
  assert.deepEqual(one(g, "RIFE VFI")[1].inputs.frames, [joinId, 0]);
  const poster = byClass(g, "ImageFromBatch").find(([, n]) => n.inputs.image[0] === joinId)![1];
  assert.equal(poster.inputs.batch_index, 81 + 80 - 1); // the seam frame is dropped once
  assert.equal(byClass(videoGraph({ ...video, seconds: 5 }, { start: "s.png" }) as G, "ImageBatch").length, 0);
});

test("beats hands each chained segment its own sentences", () => {
  assert.deepEqual(beats("She waves. She turns. She sits. She smiles.", 2), ["She waves. She turns.", "She sits. She smiles."]);
  assert.deepEqual(beats("She waves at the camera", 2), ["She waves at the camera", "She waves at the camera"]);
  assert.deepEqual(beats("She waves! Then turns.", 3), ["She waves!", "She waves!", "Then turns."]);
  assert.deepEqual(beats("  A. B.  ", 1), ["A. B."]);
});

test("a 10 s i2v gives each segment its own beat of the prompt", () => {
  const g = videoGraph({ ...video, seconds: 10, motion: "low", prompt: "She looks down. She covers up." }, { start: "s.png" }) as G;
  const texts = byClass(g, "WanImageToVideo").map(([, n]) => g[n.inputs.positive[0]].inputs.text);
  assert.deepEqual(texts, ["She looks down., subtle gentle movement", "She covers up., subtle gentle movement"]);
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
  assert.equal(wanFrames(0), 9); // floor 0.5 s (sprite clips)
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

test("Krea 2 and MOSS checkpoints get their own encoder, VAE and latent, with plain CLIPTextEncode", () => {
  assert.deepEqual(["BSSDesirexKrea2_x3.safetensors", "pornmasterMoss_v1.safetensors", qwen.model, photo.model].map(family), ["krea2", "moss", "qwen", "sdxl"]);
  for (const [model, clip, type, vae, latent] of [
    ["krea2Softrealism_v10.safetensors", "qwen3vl_4b_fp8_scaled.safetensors", "krea2", "qwen_image_vae.safetensors", "EmptyLatentImage"],
    ["miaomiaoHaremMOSS_baseV10_3316568.safetensors", "qwen3.5_9b_int8_convrot.safetensors", "moss_image", "flux2-vae.safetensors", "EmptyFlux2LatentImage"],
  ]) {
    const g = photoGraph({ ...photo, model, negative: "bad", faceFix: true, loras: [{ name: "a.safetensors", strength: 1 }] }) as G;
    assert.equal(byClass(g, "CheckpointLoaderSimple").length + byClass(g, "TextEncodeQwenImage21").length, 0);
    assert.deepEqual(one(g, "CLIPLoader")[1].inputs, { clip_name: clip, type, device: "default" });
    assert.equal(one(g, "VAELoader")[1].inputs.vae_name, vae);
    assert.equal(g.latent.class_type, latent);
    assert.deepEqual([g.pos.inputs.text, g.neg.inputs.text, g.sampler.inputs.positive, g.sampler.inputs.negative], [photo.prompt, "bad", ["pos", 0], ["neg", 0]]);
    assert.deepEqual([g.sampler.inputs.model, g.face.inputs.positive, g.face.inputs.guide_size], [["lora1", 0], ["pos", 0], 1024]);
  }
  assert.throws(() => validatePhoto({ ...photo, model: "krea2Softrealism_v10.safetensors", swap: { base: "a.png", head: "b.png" } }), /Head swap needs a Qwen model/);
});

test("validatePhoto refuses pose on a Qwen model but keeps LoRAs", () => {
  const base = { ...qwen, seed: 1 };
  assert.throws(() => validatePhoto({ ...base, pose: { kind: "pose", image: "pose.png", strength: 1 } }), /Pose isn't available for Qwen, Krea or MOSS models/);
  assert.deepEqual(validatePhoto({ ...base, loras: [{ name: "x", strength: 1 }] }).loras, [{ name: "x", strength: 1 }]);
  assert.equal(validatePhoto(base).model, qwen.model);
});

test("qwen photo graph chains model-only LoRAs between the UNET and every sampler", () => {
  const g = photoGraph({ ...qwen, loras: [{ name: "a.safetensors", strength: 0.8 }, { name: "b.safetensors", strength: -0.5 }], hires: { scale: 1.5, denoise: 0.4 } }) as G;
  assert.deepEqual(g.lora1.inputs, { model: ["unet", 0], lora_name: "a.safetensors", strength_model: 0.8 });
  assert.deepEqual(g.lora2.inputs, { model: ["lora1", 0], lora_name: "b.safetensors", strength_model: -0.5 });
  assert.equal(byClass(g, "LoraLoader").length, 0);
  for (const [, s] of byClass(g, "KSampler")) assert.deepEqual(s.inputs.model, ["lora2", 0]);
  assert.deepEqual((photoGraph(qwen) as G).sampler.inputs.model, ["unet", 0]);
});

test("head swap feeds body + head as images.image_1/2, samples the encoder latent, and adds the BFS LoRA once", () => {
  const sw = { ...qwen, prompt: "smiling", swap: { base: "b.png", head: "h.png" }, loras: [{ name: "a.safetensors", strength: 0.5 }], hires: { scale: 1.5, denoise: 0.4 } };
  const g = photoGraph(sw) as G;
  const e = g.enc.inputs;
  assert.deepEqual([e["images.image_1"], e["images.image_2"], e.vae], [["body", 0], ["head", 0], ["vae", 0]]);
  assert.equal(e.image_1, undefined);
  assert.deepEqual([g.body.inputs.image, g.head.inputs.image], ["b.png", "h.png"]);
  assert.equal(e.prompt, `${BFS_PROMPT}, smiling`);
  assert.equal(g.latent, undefined);
  assert.deepEqual([g.sampler.inputs.latent_image, g.hires_sampler.inputs.latent_image], [["enc", 2], ["hires_up", 0]]);
  assert.deepEqual(g.lora_bfs.inputs, { model: ["lora1", 0], lora_name: BFS_LORA, strength_model: 1 });
  assert.deepEqual([g.sampler.inputs.model, g.hires_sampler.inputs.model], [["lora_bfs", 0], ["lora_bfs", 0]]);
  const picked = photoGraph({ ...sw, loras: [{ name: BFS_LORA, strength: 0.8 }] }) as G;
  assert.equal(picked.lora_bfs, undefined, "a BFS LoRA the owner picked keeps its strength");
  assert.equal((photoGraph({ ...sw, prompt: " " }) as G).enc.inputs.prompt, BFS_PROMPT);
});

test("validatePhoto: swap needs Qwen, uploaded image names, and the BFS LoRA on the GPU", () => {
  const base = { ...qwen, seed: 1, swap: { base: "b.png", head: "h.png" } };
  assert.deepEqual(validatePhoto(base).swap, { base: "b.png", head: "h.png" });
  assert.equal("swap" in validatePhoto({ ...base, swap: null }), false);
  assert.throws(() => validatePhoto({ ...base, model: photo.model }), /Head swap needs a Qwen model/);
  assert.throws(() => validatePhoto({ ...base, swap: { base: "../x.png", head: "h.png" } }), /body image/);
  assert.throws(() => validatePhoto(base, { checkpoints: [qwen.model], loras: [] }), /isn't on the GPU/);
  assert.ok(validatePhoto(base, { checkpoints: [qwen.model], loras: [BFS_LORA] }).swap);
});

test("faceFix runs FaceDetailer on the decode and saves its output, with plain prompt conditioning", () => {
  assert.equal(byClass(photoGraph(photo) as G, "FaceDetailer").length, 0);
  const pose = { ...photo, faceFix: true, pose: { kind: "pose" as const, image: "p.png", strength: 1 } };
  const g = photoGraph(pose) as G;
  const [id, fd] = one(g, "FaceDetailer");
  assert.deepEqual(fd.inputs.image, ["decode", 0]);
  assert.deepEqual([fd.inputs.positive, fd.inputs.negative, fd.inputs.vae], [["pos", 0], ["neg", 0], ["ckpt", 2]]);
  assert.equal(one(g, "UltralyticsDetectorProvider")[1].inputs.model_name, FACE_DETECTOR);
  assert.deepEqual(one(g, "SaveImage")[1].inputs.images, [id, 0]);
  const q = one(photoGraph({ ...qwen, faceFix: true, swap: { base: "b.png", head: "h.png" } }) as G, "FaceDetailer")[1];
  assert.deepEqual([q.inputs.positive, q.inputs.clip, q.inputs.guide_size], [["enc", 0], ["clip", 0], 1024]);
  assert.equal(validatePhoto({ ...photo, seed: 1, faceFix: true }).faceFix, true);
  assert.equal("faceFix" in validatePhoto({ ...photo, seed: 1, faceFix: "yes" }), false);
});
