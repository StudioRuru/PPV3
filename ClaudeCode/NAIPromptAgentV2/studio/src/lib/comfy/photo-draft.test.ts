import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPhoto, loadPhoto, savePhoto } from "./photo-draft";

test("default recipe uses first checkpoint and spec sizes", () => {
  const r = defaultPhoto(["a.safetensors", "b.safetensors"]);
  assert.equal(r.model, "a.safetensors");
  assert.deepEqual([r.width, r.height, r.steps, r.cfg, r.seed], [832, 1216, 28, 5.5, -1]);
  assert.deepEqual([r.sampler, r.scheduler], ["euler_ancestral", "normal"]);
  assert.equal(r.pose, null);
  assert.equal(r.hires, null);
  assert.equal(defaultPhoto([]).model, "");
});

test("loadPhoto survives storage throwing", () => {
  const boom = () => { throw new Error("blocked"); };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: boom, setItem: boom };
  try {
    assert.equal(loadPhoto(), null);
    assert.doesNotThrow(() => savePhoto(defaultPhoto(["a"])));
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("savePhoto round-trips and drops the pose", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    savePhoto({ ...defaultPhoto(["a"]), steps: 33, pose: { kind: "pose", image: "x.png", strength: 1 } });
    const r = loadPhoto()!;
    assert.equal(r.steps, 33);
    assert.equal(r.pose, null);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
