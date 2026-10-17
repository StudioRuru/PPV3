import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "./store";
import { defaultPhoto, defaultVideo } from "./photo-draft";
import { asStartFrame, reuseTarget } from "./reuse";

const item = (kind: Item["kind"], recipe: unknown, seed = 777): Item => ({ id: 5, kind, file: "a.png", poster: null, recipe, seed, cost: 0, createdAt: 1 });

test("photo item reuses into photo pane with its seed", () => {
  const t = reuseTarget(item("photo", { ...defaultPhoto(["m.safetensors"]), seed: -1, prompt: "hi" }));
  assert.equal(t.pane, "photo");
  assert.equal(t.recipe.seed, 777);
  assert.equal((t.recipe as { prompt: string }).prompt, "hi");
});

test("clip item reuses into video pane", () => {
  const t = reuseTarget(item("clip", { ...defaultVideo(), start: 3 }));
  assert.equal(t.pane, "video");
  assert.equal(t.recipe.seed, 777);
});

test("asStartFrame sets start and animate mode", () => {
  const v = asStartFrame(item("photo", {}), { ...defaultVideo(), mode: "t2v", end: 9 });
  assert.equal(v.start, 5);
  assert.equal(v.mode, "animate");
  assert.equal(v.startImage, undefined);
});

test("clip reuse clears start and end frames", () => {
  const t = reuseTarget(item("clip", { ...defaultVideo(), start: 3, end: 4 }));
  assert.equal(t.pane, "video");
  assert.deepEqual([t.recipe.start, (t.recipe as { end: number | null }).end], [null, null]);
});
