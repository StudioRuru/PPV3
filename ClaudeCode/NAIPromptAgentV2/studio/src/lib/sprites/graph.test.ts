import { test } from "node:test";
import assert from "node:assert/strict";
import { wanFrames } from "../comfy/recipe";
import { SPRITE_LORAS, missingSpriteLoras } from "./loras";
import { editGraph, secondsFor, spriteRecipe } from "./graph";

test("wanFrames allows sub-second sprite clips", () => { assert.equal(wanFrames(0.75), 13); assert.equal(wanFrames(2.5), 41); assert.equal(wanFrames(0.1), 9); });
test("pose graph loads her LoRA, img2img from the base", () => {
  const g = editGraph({ preset: "pose", base: 1, prompt: "smug", seed: 1, width: 768, height: 1344, target: { takeId: 1 } }, "b.png") as Record<string, any>;
  const nodes = Object.values(g) as any[];
  assert.ok(nodes.some((n) => n.class_type === "LoraLoaderModelOnly" && n.inputs.lora_name === SPRITE_LORAS.image.name));
  assert.ok(nodes.some((n) => n.class_type === "VAEEncode"));
  assert.ok(!nodes.some((n) => n.class_type === "ReferenceLatent"));
  assert.ok(nodes.find((n) => n.class_type === "KSampler").inputs.denoise < 1);
  assert.equal(nodes.find((n) => n.class_type === "LoadImage").inputs.image, "b.png");
  assert.ok(nodes.some((n) => n.class_type === "CLIPTextEncode" && n.inputs.text.startsWith("miyabi_sprite, ")));
});
test("missing LoRA is named", () => {
  assert.deepEqual(missingSpriteLoras([]), [SPRITE_LORAS.image.name, ...SPRITE_LORAS.wan.map((w) => w.name)]);
  assert.deepEqual(missingSpriteLoras([SPRITE_LORAS.image.name]), SPRITE_LORAS.wan.map((w) => w.name));
});
test("spriteRecipe: idle loops, transitions animate, 30fps portrait", () => {
  assert.equal(spriteRecipe({ surface: "chat", start: 3, end: 3, prompt: "", seconds: 2.5, seed: 1, target: { takeId: 1 } }).mode, "loop");
  const t = spriteRecipe({ surface: "chat", start: 3, end: 4, prompt: "", seconds: 0.75, seed: 1, target: { takeId: 1 } });
  assert.deepEqual([t.mode, t.fps, t.size, t.steps, t.cfg], ["animate", 30, "720p", 8, 1]);
});
test("sprite clips carry her Wan LoRA", () => {
  assert.deepEqual(spriteRecipe({ surface: "chat", start: 3, end: 4, prompt: "x", seconds: 0.75, seed: 1, target: { takeId: 1 } }).loras, SPRITE_LORAS.wan);
});
test("secondsFor", () => { assert.equal(secondsFor("chat", false), 0.75); assert.equal(secondsFor("chat", true), 2.5); assert.equal(secondsFor("stage", false), 2.5); });
