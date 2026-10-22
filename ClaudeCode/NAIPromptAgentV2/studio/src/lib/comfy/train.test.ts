import test from "node:test";
import assert from "node:assert/strict";
import { buildConfig, caption, parseProgress, trainName } from "./train";

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
