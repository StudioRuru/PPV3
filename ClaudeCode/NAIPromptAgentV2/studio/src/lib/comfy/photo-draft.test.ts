import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPhoto, defaultVideo, photoTune, videoTune, loadPhoto, loadVideo, savePhoto, saveVideo, VIDEO_DRAFT_KEY } from "./photo-draft";

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

test("loadPhoto ignores wrong-typed fields", () => {
  const bad = { mode: "photo", model: 5, steps: "30", cfg: null, width: Infinity, seed: 7, prompt: "hi", loras: [{ name: 1, strength: 1 }, { name: "a", strength: 0.5 }], hires: { scale: "x" } };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(bad) };
  try {
    const r = loadPhoto()!;
    const d = defaultPhoto([]);
    assert.deepEqual([r.model, r.steps, r.cfg, r.width], [d.model, d.steps, d.cfg, d.width]);
    assert.deepEqual([r.seed, r.prompt], [7, "hi"]);
    assert.deepEqual(r.loras, [{ name: "a", strength: 0.5 }]);
    assert.equal(r.hires, null);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("default video recipe matches the spec defaults", () => {
  const r = defaultVideo();
  assert.deepEqual([r.mode, r.seconds, r.motion, r.fps, r.size, r.steps, r.cfg, r.seed], ["animate", 5, "medium", 60, "480p", 8, 1, -1]);
  assert.deepEqual([r.start, r.end, r.loras], [null, null, []]);
});

test("loadVideo ignores wrong-typed fields and bad enums; saveVideo round-trips", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    saveVideo({ ...defaultVideo(), seconds: 8, mode: "loop", prompt: "wind" });
    const r = loadVideo()!;
    assert.deepEqual([r.seconds, r.mode, r.prompt], [8, "loop", "wind"]);
    store.set(VIDEO_DRAFT_KEY, JSON.stringify({ mode: "bogus", seconds: "9", fps: 24, size: "4k", motion: "high", start: 3, end: "x", prompt: 5 }));
    const b = loadVideo()!, d = defaultVideo();
    assert.deepEqual([b.mode, b.seconds, b.fps, b.size, b.motion, b.start, b.end, b.prompt], [d.mode, d.seconds, d.fps, d.size, "high", 3, null, ""]);
    store.clear();
    assert.equal(loadVideo(), null);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("videoTune: t2v 20/3.5, Smooth Mix i2v 8/1", () => {
  assert.deepEqual(videoTune("t2v"), { steps: 20, cfg: 3.5 });
  assert.deepEqual(videoTune("loop"), { steps: 8, cfg: 1 });
  assert.equal(defaultVideo().steps, 8);
  assert.equal(defaultVideo().cfg, 1);
});

test("photoTune per family; defaultPhoto follows the first model", () => {
  assert.deepEqual(photoTune("noctQAnime_v10_fp8.safetensors"), { steps: 25, cfg: 3, sampler: "euler", scheduler: "simple" });
  assert.deepEqual(photoTune("waiIllustriousSDXL_v170.safetensors"), { steps: 28, cfg: 5.5, sampler: "euler_ancestral", scheduler: "normal" });
  const q = defaultPhoto(["noctQRealism_v40Base_fp8.safetensors"]);
  assert.deepEqual([q.steps, q.cfg, q.sampler, q.scheduler], [25, 3, "euler", "simple"]);
});
