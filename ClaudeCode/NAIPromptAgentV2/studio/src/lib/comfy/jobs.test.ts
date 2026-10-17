import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { drainQueue, type Deps } from "./jobs";
import { migrate, addJob, readJob, listItems, addItem, updateJob, getState } from "./store";
import type { OutFile } from "./client";

const PHOTO = {
  mode: "photo", model: "ck.safetensors", prompt: "1girl", negative: "bad", loras: [{ name: "a.safetensors", strength: 1 }], pose: null,
  seed: 42, steps: 20, cfg: 6, sampler: "euler", scheduler: "normal", width: 832, height: 1216, hires: null,
};
const out = (filename: string): OutFile => ({ filename, subfolder: "", type: "output" });

const dirs: string[] = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function setup() {
  delete (globalThis as { __comfyQueue?: unknown }).__comfyQueue; // queue state is process-global; isolate each test
  const db = new Database(":memory:");
  migrate(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-jobs-"));
  dirs.push(dir);
  let now = 1_000_000;
  const o = {
    phase: "off" as string, boost: "off" as string, warms: 0, warmed: [] as string[], interrupts: 0, signals: [] as (AbortSignal | undefined)[],
    fetch: (f: OutFile): Buffer => Buffer.from(`bytes:${f.filename}`), submits: [] as object[], uploads: [] as { name: string; size: number }[], watched: [] as string[],
    watch: async (): Promise<{ files: OutFile[] }> => ({ files: [out("studio_00001_.png")] }),
    models: { checkpoints: ["ck.safetensors"], loras: ["a.safetensors"], samplers: [], schedulers: [] },
    history: {} as unknown,
  };
  const eng = {
    view: () => ({ main: { phase: o.phase, usdHr: 3.6, boost: o.boost }, boost: { phase: "off", usdHr: 0, boost: o.boost } }),
    warm: async (card: string) => { o.warms++; o.warmed.push(card); return {}; },
    base: (card: string) => `http://pod-${card}`,
  } as unknown as Deps["eng"];
  const client: Deps["client"] = {
    listModels: async () => o.models,
    upload: async (_b, name, png) => { o.uploads.push({ name, size: png.length }); return `up/${name}`; },
    submit: async (_b, graph) => { o.submits.push(graph); return `p${o.submits.length}`; },
    watch: async (_b, id, onProgress, opts) => { o.watched.push(id); o.signals.push(opts?.signal); onProgress(0.5); return o.watch(); },
    fetchOutput: async (_b, f) => o.fetch(f),
    history: async () => o.history,
    interrupt: async () => { o.interrupts++; },
  };
  const d: Deps = { db, eng, client, dir, now: () => now };
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(fn(), "condition not reached");
  };
  return { db, dir, o, d, until, advance: (ms: number) => { now += ms; } };
}

test("queued job waits while warming and runs when ready", async () => {
  const s = setup();
  const id = addJob(s.db, "photo", PHOTO, "main", 1);
  await drainQueue(s.d);
  assert.equal(s.o.warms, 1, "a cold card is warmed");
  s.o.phase = "warming";
  await drainQueue(s.d);
  assert.equal(readJob(s.db, id)!.status, "queued");
  assert.equal(s.o.submits.length, 0);
  s.o.phase = "ready";
  await drainQueue(s.d);
  assert.equal(s.o.submits.length, 1);
  assert.equal(getState(s.db).lastActivity, 1_000_000, "submit touches lastActivity");
  await s.until(() => readJob(s.db, id)!.status === "done");
  assert.equal(readJob(s.db, id)!.promptId, "p1");
});

test("error leaves no item and the next job runs", async () => {
  const s = setup();
  s.o.phase = "ready";
  const a = addJob(s.db, "photo", PHOTO, "main", 1);
  const b = addJob(s.db, "photo", PHOTO, "main", 2);
  let calls = 0;
  s.o.watch = async () => {
    if (++calls === 1) throw new Error("CUDA out of memory");
    return { files: [out("studio_00002_.png")] };
  };
  await drainQueue(s.d);
  await s.until(() => readJob(s.db, a)!.status === "error");
  assert.equal(readJob(s.db, a)!.error, "CUDA out of memory");
  assert.equal(readJob(s.db, a)!.itemId, null);
  // the finished job kicks the queue itself, without waiting for the 30 s tick
  await s.until(() => readJob(s.db, b)!.status === "done");
  assert.deepEqual(listItems(s.db).map((i) => i.id), [readJob(s.db, b)!.itemId], "only the good job adds an item");
});

test("done writes file + poster and adds an item with recipe and seed", async () => {
  const s = setup();
  s.o.phase = "ready";
  fs.writeFileSync(path.join(s.dir, "ref-1.png"), await sharp({ create: { width: 64, height: 128, channels: 3, background: "#000" } }).png().toBuffer());
  const recipe = { mode: "animate", prompt: "wave", negative: "", loras: [], start: null, startImage: "ref-1.png", end: null, seconds: 2, motion: "low", fps: 16, size: "480p", seed: 99, steps: 10, cfg: 3 };
  const id = addJob(s.db, "video", recipe, "main", 1);
  s.o.watch = async () => ({ files: [out("studio-clip_00001.mp4"), out("studio-last_00001_.png")] });
  await drainQueue(s.d);
  s.advance(600_000); // 10 min of GPU at $3.60/h
  await s.until(() => readJob(s.db, id)!.status === "done");
  assert.deepEqual(s.o.uploads, [{ name: "ref-1.png", size: fs.statSync(path.join(s.dir, "ref-1.png")).size }]);
  const graph = s.o.submits[0] as Record<string, { class_type: string; inputs: any }>;
  const load = Object.values(graph).find((n) => n.class_type === "LoadImage")!;
  assert.equal(load.inputs.image, "up/ref-1.png");
  const wan = Object.values(graph).find((n) => n.class_type === "WanImageToVideo")!;
  assert.ok(wan.inputs.height > wan.inputs.width, "portrait start frame gives a portrait clip");
  const [item] = listItems(s.db);
  assert.equal(item.kind, "clip");
  assert.equal(item.seed, 99);
  assert.deepEqual(item.recipe, recipe);
  assert.match(item.file, /^\d{14}-99\.mp4$/);
  assert.equal(item.poster, item.file.replace(/\.mp4$/, "-last.png"));
  assert.equal(fs.readFileSync(path.join(s.dir, item.file), "utf8"), "bytes:studio-clip_00001.mp4");
  assert.equal(fs.readFileSync(path.join(s.dir, item.poster!), "utf8"), "bytes:studio-last_00001_.png");
  assert.ok(Math.abs(item.cost - 0.6) < 1e-9);
  assert.equal(readJob(s.db, id)!.itemId, item.id);
  assert.equal(readJob(s.db, id)!.progress, 1);
});

test("extend starts from the clip's stored last frame", async () => {
  const s = setup();
  s.o.phase = "ready";
  fs.writeFileSync(path.join(s.dir, "c-last.png"), await sharp({ create: { width: 128, height: 64, channels: 3, background: "#000" } }).png().toBuffer());
  const clip = addItem(s.db, { kind: "clip", file: "c.mp4", poster: "c-last.png", recipe: {}, seed: 1, cost: 0, createdAt: 1 });
  addJob(s.db, "video", { mode: "extend", prompt: "", negative: "", loras: [], start: clip, end: null, seconds: 2, motion: "medium", fps: 16, size: "480p", seed: 5, steps: 10, cfg: 3 }, "main", 1);
  s.o.watch = async () => ({ files: [out("v.mp4"), out("studio-last_1.png")] });
  await drainQueue(s.d);
  await s.until(() => listItems(s.db).length === 2);
  assert.equal(s.o.uploads[0].name, "c-last.png");
});

test("a LoRA that vanished from the pod fails the job by name before submit", async () => {
  const s = setup();
  s.o.phase = "ready";
  s.o.models = { ...s.o.models, loras: [] };
  const id = addJob(s.db, "photo", PHOTO, "main", 1);
  await drainQueue(s.d);
  const j = readJob(s.db, id)!;
  assert.equal(j.status, "error");
  assert.match(j.error!, /LoRA “a\.safetensors” isn't on the GPU any more/);
  assert.equal(s.o.submits.length, 0);
});

test("after a restart a running job is re-watched by promptId, or errored without one", async () => {
  const s = setup();
  s.o.phase = "ready";
  const a = addJob(s.db, "photo", PHOTO, "main", 1);
  updateJob(s.db, a, { status: "running", promptId: "old-p" });
  await drainQueue(s.d);
  assert.deepEqual(s.o.watched, ["old-p"]);
  assert.equal(s.o.submits.length, 0);
  await s.until(() => readJob(s.db, a)!.status === "done");

  const b = addJob(s.db, "photo", PHOTO, "main", 2);
  updateJob(s.db, b, { status: "running" });
  await drainQueue(s.d);
  assert.equal(readJob(s.db, b)!.status, "error");
  assert.match(readJob(s.db, b)!.error!, /restarted/);
});

test("a job running past 45 min is marked as a dead GPU and the queue moves on", async () => {
  const s = setup();
  s.o.phase = "ready";
  s.o.watch = () => new Promise(() => {}); // a silently dead WebSocket
  const a = addJob(s.db, "photo", PHOTO, "main", 1);
  const b = addJob(s.db, "photo", PHOTO, "main", 2);
  await drainQueue(s.d);
  s.advance(44 * 60_000);
  await drainQueue(s.d);
  assert.equal(readJob(s.db, a)!.status, "running");
  s.advance(2 * 60_000);
  await drainQueue(s.d);
  assert.equal(readJob(s.db, a)!.error, "The GPU stopped responding during this job.");
  assert.equal(s.o.interrupts, 1, "the stuck prompt is interrupted on the pod");
  assert.equal(s.o.signals[0]?.aborted, true, "the stuck watch is told to stop");
  assert.equal(readJob(s.db, b)!.status, "running", "next job submitted");
});

test("pose jobs return keypoints and the preprocessed image in recipe.result", async () => {
  const s = setup();
  s.o.phase = "ready";
  fs.writeFileSync(path.join(s.dir, "ref-2.png"), Buffer.from("png"));
  const kps = [{ people: [{ pose_keypoints_2d: [1, 2, 1] }], canvas_width: 512, canvas_height: 512 }];
  s.o.history = { "p1": { outputs: { pose: { openpose_json: [JSON.stringify(kps)] }, save: { images: [out("pose_1.png")] } } } };
  s.o.watch = async () => ({ files: [out("pose_1.png")] });
  const id = addJob(s.db, "pose", { kind: "pose", image: "ref-2.png" }, "main", 1);
  await drainQueue(s.d);
  await s.until(() => readJob(s.db, id)!.status === "done");
  const j = readJob(s.db, id)!;
  const result = (j.recipe as { result: { image: string; keypoints: unknown } }).result;
  assert.deepEqual(result.keypoints, kps[0]);
  assert.equal(fs.readFileSync(path.join(s.dir, result.image), "utf8"), "bytes:pose_1.png");
  assert.equal(listItems(s.db).length, 0);
  assert.equal(j.itemId, null);
});

test("two concurrent drains submit once and add one item", async () => {
  const s = setup();
  s.o.phase = "ready";
  const id = addJob(s.db, "photo", PHOTO, "main", 1);
  await Promise.all([drainQueue(s.d), drainQueue(s.d)]);
  await s.until(() => readJob(s.db, id)!.status === "done");
  await drainQueue(s.d);
  assert.equal(s.o.submits.length, 1);
  assert.equal(listItems(s.db).length, 1);
});

test("a boost job runs on main when boost is off, and boost is never warmed", async () => {
  const s = setup();
  const id = addJob(s.db, "video", { mode: "t2v", prompt: "rain", negative: "", loras: [], start: null, end: null, seconds: 2, motion: "medium", fps: 16, size: "480p", seed: 3, steps: 10, cfg: 3 }, "boost", 1);
  s.o.watch = async () => ({ files: [out("v.mp4"), out("studio-last_1.png")] });
  await drainQueue(s.d);
  assert.deepEqual(s.o.warmed, ["main"]);
  assert.equal(readJob(s.db, id)!.card, "main");
  s.o.phase = "ready";
  await drainQueue(s.d);
  await s.until(() => readJob(s.db, id)!.status === "done");
  assert.deepEqual(s.o.warmed, ["main"]);
});

test("a failed poster fetch removes the written clip and adds no item", async () => {
  const s = setup();
  s.o.phase = "ready";
  const id = addJob(s.db, "video", { mode: "t2v", prompt: "rain", negative: "", loras: [], start: null, end: null, seconds: 2, motion: "medium", fps: 16, size: "480p", seed: 3, steps: 10, cfg: 3 }, "main", 1);
  s.o.watch = async () => ({ files: [out("v.mp4"), out("studio-last_1.png")] });
  s.o.fetch = (f) => { if (f.filename.startsWith("studio-last")) throw new Error("view failed"); return Buffer.from("clip"); };
  await drainQueue(s.d);
  await s.until(() => readJob(s.db, id)!.status === "error");
  assert.equal(readJob(s.db, id)!.error, "view failed");
  assert.equal(listItems(s.db).length, 0);
  assert.deepEqual(fs.readdirSync(s.dir), []);
});
