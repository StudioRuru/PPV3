import { test } from "node:test";
import assert from "node:assert/strict";
import { wanFrames } from "../comfy/recipe";
import { EDIT_PRESETS, editGraph, secondsFor, spriteRecipe } from "./graph";

test("wanFrames allows sub-second sprite clips", () => { assert.equal(wanFrames(0.75), 13); assert.equal(wanFrames(2.5), 41); assert.equal(wanFrames(0.1), 9); });
test("editGraph wires base image and vae into TextEncodeQwenImage21", () => {
  const g = editGraph({ preset: "noct", base: 1, prompt: "smiling", seed: 5, width: 768, height: 1344, target: { takeId: 1 } }, "b.png") as Record<string, any>;
  const enc = Object.values(g).find((n: any) => n.class_type === "TextEncodeQwenImage21");
  assert.ok(Array.isArray(enc.inputs["images.image_1"]) && Array.isArray(enc.inputs.vae));
  assert.equal(Object.values(g).find((n: any) => n.class_type === "LoadImage").inputs.image, "b.png");
});
test("turbo preset uses ManualSigmas + CFGGuider 1", () => {
  const g = editGraph({ preset: "turbo", base: 1, prompt: "x", seed: 5, width: 768, height: 1344, target: { takeId: 1 } }, "b.png") as Record<string, any>;
  const v = Object.values(g) as any[];
  assert.equal(v.find((n) => n.class_type === "ManualSigmas").inputs.sigmas, (EDIT_PRESETS.turbo.sampler as { sigmas: string }).sigmas);
  assert.equal(v.find((n) => n.class_type === "CFGGuider").inputs.cfg, 1);
});
test("spriteRecipe: idle loops, transitions animate, 30fps portrait", () => {
  assert.equal(spriteRecipe({ surface: "chat", start: 3, end: 3, prompt: "", seconds: 2.5, seed: 1, target: { takeId: 1 } }).mode, "loop");
  const t = spriteRecipe({ surface: "chat", start: 3, end: 4, prompt: "", seconds: 0.75, seed: 1, target: { takeId: 1 } });
  assert.deepEqual([t.mode, t.fps, t.size, t.steps, t.cfg], ["animate", 30, "480p", 8, 1]);
});
test("secondsFor", () => { assert.equal(secondsFor("chat", false), 0.75); assert.equal(secondsFor("chat", true), 2.5); assert.equal(secondsFor("stage", false), 2.5); });
