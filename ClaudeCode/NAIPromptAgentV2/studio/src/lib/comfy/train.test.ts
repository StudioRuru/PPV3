import test from "node:test";
import assert from "node:assert/strict";
import { AIT_ARCH, POSE_FAMILY, STEPS, buildConfig, caption, captionFiles, finalLoras, parseProgress, trainName } from "./train";

test("trainName takes plain lowercase names only", () => {
  assert.equal(trainName("maya_face"), "maya_face");
  for (const bad of ["Maya", "a", "x'; rm -rf /", "1abc", "has space"]) assert.equal(trainName(bad), null);
});

test("captions carry the trigger", () => {
  assert.equal(caption("face", "maya"), "maya, photo of a person");
  assert.equal(caption("scene", "maya"), "maya");
});

test("buildConfig targets the right base and scheduler per arch", () => {
  const sdxl = JSON.parse(buildConfig({ id: "1", name: "maya", arch: "sdxl", steps: 2000 })).config.process[0];
  assert.equal(sdxl.model.arch, "sdxl");
  assert.match(sdxl.model.name_or_path, /waiIllustrious/);
  assert.equal(sdxl.train.noise_scheduler, "ddpm");
  assert.equal(sdxl.train.steps, 2000);
  assert.equal(sdxl.datasets[0].folder_path, "/opt/train/1/data");
  const qwen = JSON.parse(buildConfig({ id: "2", name: "maya", arch: "qwen", steps: 1500 })).config.process[0];
  assert.equal(qwen.model.arch, "qwen_image_2");
  assert.equal(qwen.train.noise_scheduler, "flowmatch");
});

test("parseProgress reads the last tqdm step of the training bar", () => {
  const log = "Caching latents 10/10 [00:02]\nmaya:  12%|█ | 240/2000 [01:00<07:00]\rmaya:  13%|█ | 260/2000 [01:05<07:00]";
  assert.equal(parseProgress(log, 2000), 0.13);
  assert.equal(parseProgress("loading…", 2000), 0);
});

const proc = (arch: "sdxl" | "qwen" | "moss" | "wan22") => JSON.parse(buildConfig({ id: "9", name: "miyabi_sprite_wan", arch, steps: STEPS[arch] })).config.process[0];
test("wan22 config: rank 32, 512-768, single-frame, control image", () => {
  const p = proc("wan22");
  assert.equal(p.network.linear, 32);
  assert.deepEqual(p.datasets[0].resolution, [512, 768]);
  assert.equal(p.datasets[0].num_frames, 1);
  assert.equal(p.model.arch, AIT_ARCH.wan22);
  assert.equal(p.model.name_or_path, "ai-toolkit/Wan2.2-I2V-A14B-Diffusers-bf16");
  assert.deepEqual(p.model.model_kwargs, { train_high_noise: true, train_low_noise: true });
  assert.equal(p.sample.samples[0].ctrl_img, "/opt/train/9/data/0.png");
});
test("wan22 config: step saves every 500 keeping 2; moss and wan22 disable sampling", () => {
  assert.equal(proc("wan22").save.save_every, 500);
  assert.equal(proc("wan22").save.max_step_saves_to_keep, 2);
  assert.equal(proc("moss").save.save_every, STEPS.moss);
  assert.equal(proc("moss").train.disable_sampling, true);
  assert.equal(proc("wan22").train.disable_sampling, true);
  assert.equal(proc("sdxl").train.disable_sampling, undefined);
});
test("pose arches use their AIT arch and local MOSS files", () => {
  assert.equal(POSE_FAMILY, "moss");
  for (const a of ["moss"] as const) assert.equal(proc(a).model.arch, AIT_ARCH[a]);
  assert.match(proc("moss").model.name_or_path, /pornmasterMoss_v1\.safetensors$/);
  assert.equal(proc("sdxl").network.linear, 16);
});
test("per-image captions must match image count", () => assert.throws(() => captionFiles(["a.png", "b.png"], ["x"]), /caption/));
test("per-image captions pair by index", () => assert.deepEqual(captionFiles(["a.png", "b.png"], ["x", "y"]), [["a.txt", "x"], ["b.txt", "y"]]));
test("final loras: step checkpoints are skipped", () => {
  assert.deepEqual(finalLoras(["m_000000500.safetensors", "maya_2.safetensors", "m_high_noise.safetensors", "m_low_noise.safetensors", "m.yaml"]), ["maya_2.safetensors", "m_high_noise.safetensors", "m_low_noise.safetensors"]);
  assert.deepEqual(finalLoras(["m_000000500_high_noise.safetensors", "m_000000500_low_noise.safetensors", "m_high_noise.safetensors", "maya_2.safetensors"]), ["m_high_noise.safetensors", "maya_2.safetensors"]);
  assert.deepEqual(finalLoras(["miyabi_sprite_img_000005000.safetensors", "miyabi_sprite_img.safetensors"]), ["miyabi_sprite_img.safetensors"]);
});
