import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import sharp from "sharp";
import { type Job, addItem, comfyDb, nextQueued, readItem, readJob, setState, updateJob } from "./store";
import { type OutFile, fetchOutput, listModels, submit, upload, watch } from "./client";
import { Refused, getEngine } from "./engine";
import { type PoseJob, photoGraph, poseGraph, validatePhoto, validatePose, validateVideo, videoGraph } from "./recipe";
import { COMFY_DIR } from "@/lib/env";

type Db = Database.Database;
type Models = Awaited<ReturnType<typeof listModels>>;
export type Client = {
  listModels: typeof listModels; upload: typeof upload; submit: typeof submit; watch: typeof watch; fetchOutput: typeof fetchOutput;
  history: (base: string, promptId: string) => Promise<unknown>;
};
export type Deps = { db: Db; eng: Pick<ReturnType<typeof getEngine>, "view" | "warm" | "base">; client: Client; dir: string; now: () => number };

const realClient: Client = {
  listModels, upload, submit, watch, fetchOutput,
  history: async (base, id) => {
    const res = await fetch(`${base}/history/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`ComfyUI /history failed: ${res.status}`);
    return res.json();
  },
};
const defaults = (): Deps => ({ db: comfyDb(), eng: getEngine(), client: realClient, dir: COMFY_DIR, now: Date.now });

const MIN = 60_000;
const LIMIT: Record<Job["kind"], number> = { photo: 45 * MIN, pose: 45 * MIN, video: 60 * MIN };
const DEAD = "The GPU stopped responding during this job.";
const RESTARTED = "The app restarted before this job reached the GPU.";

/** Per-db queue state on globalThis so it survives HMR. `token` lets a timed-out watcher know it may no longer write. */
type QState = { watchers: Map<number, { since: number; token: object }>; draining: boolean; again: boolean };
function qstate(db: Db): QState {
  const g = globalThis as { __comfyQueue?: WeakMap<Db, QState> };
  const m = (g.__comfyQueue ??= new WeakMap());
  let s = m.get(db);
  if (!s) m.set(db, (s = { watchers: new Map(), draining: false, again: false }));
  return s;
}

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "The job failed.");
const fail = (db: Db, id: number, e: unknown) => updateJob(db, id, { status: "error", error: typeof e === "string" ? e : msg(e) });

/**
 * One job at a time: re-follow/expire running jobs, then warm or submit the next queued one.
 * Never blocks on a running job — the watch runs in the background and drains again when it ends.
 */
export async function drainQueue(d: Deps = defaults()): Promise<void> {
  const st = qstate(d.db);
  if (st.draining) { st.again = true; return; }
  st.draining = true;
  try {
    do { st.again = false; await drainOnce(d, st); } while (st.again);
  } finally {
    st.draining = false;
  }
}

async function drainOnce(d: Deps, st: QState): Promise<void> {
  const { db } = d;
  const now = d.now();
  let busy = false;
  for (const { id } of db.prepare("SELECT id FROM comfy_jobs WHERE status = 'running'").all() as { id: number }[]) {
    const j = readJob(db, id)!;
    const w = st.watchers.get(id);
    if (!w) {
      // server restarted mid-job: pick the prompt back up if it reached ComfyUI
      if (j.promptId) { follow(d, j, now); busy = true; } else fail(db, id, RESTARTED);
    } else if (now - w.since > LIMIT[j.kind]) {
      st.watchers.delete(id);
      fail(db, id, DEAD);
    } else busy = true;
  }
  if (busy) return;

  const q = nextQueued(db);
  if (!q) return;
  const views = d.eng.view();
  let card = q.card;
  if (card === "boost" && views.boost.phase === "unavailable") { card = "main"; updateJob(db, q.id, { card }); }
  const phase = views[card].phase;
  if (phase === "off" || phase === "unavailable") {
    // not awaited: a cold start takes minutes; the next tick submits once ready
    d.eng.warm(card).catch((e) => { if (e instanceof Refused) fail(db, q.id, e); });
    return;
  }
  if (phase !== "ready") return;

  const j: Job = { ...q, card };
  updateJob(db, j.id, { status: "running", progress: 0 });
  const base = d.eng.base(card);
  let promptId: string;
  try {
    promptId = await d.client.submit(base, await build(d, j, base));
  } catch (e) {
    return fail(db, j.id, e);
  }
  updateJob(db, j.id, { promptId });
  setState(db, { lastActivity: d.now() });
  follow(d, { ...j, promptId }, now);
}

/** Validates against the pod's current models, uploads the images it needs, and returns the API graph. */
async function build(d: Deps, j: Job, base: string): Promise<object> {
  const put = async (name: string) => d.client.upload(base, name, read(d.dir, name));
  if (j.kind === "pose") {
    const p = validatePose(j.recipe);
    return poseGraph(await put(p.image), p.kind);
  }
  const models: Models = await d.client.listModels(base);
  if (j.kind === "photo") {
    const r = validatePhoto(j.recipe, models);
    if (r.pose) r.pose = { ...r.pose, image: await put(r.pose.image) };
    return photoGraph(r);
  }
  const r = validateVideo(j.recipe, models);
  if (r.mode === "t2v") return videoGraph(r, {});
  const frame = (id: number, what: string) => {
    const it = readItem(d.db, id);
    const file = it && (it.kind === "clip" ? it.poster : it.file);
    if (!file) throw new Error(`The ${what} frame is no longer in the Library.`);
    return file;
  };
  const startName = r.startImage ?? frame(r.start!, "start");
  const meta = await sharp(read(d.dir, startName)).metadata();
  const frames: Parameters<typeof videoGraph>[1] = { start: await put(startName), portrait: (meta.height ?? 0) > (meta.width ?? 0) };
  if (r.mode === "animate" && r.end !== null) frames.end = await put(frame(r.end, "end"));
  return videoGraph(r, frames);
}

function read(dir: string, name: string): Buffer {
  try {
    return fs.readFileSync(path.join(dir, path.basename(name)));
  } catch {
    throw new Error(`The image ${name} is missing — pick it again.`);
  }
}

function follow(d: Deps, j: Job, since: number): void {
  const st = qstate(d.db), token = {};
  st.watchers.set(j.id, { since, token });
  const live = () => st.watchers.get(j.id)?.token === token;
  const base = d.eng.base(j.card);
  d.client.watch(base, j.promptId!, (p) => { if (live()) updateJob(d.db, j.id, { progress: p }); })
    .then((out) => finish(d, j, base, out.files, since, live))
    .catch((e) => { if (live()) fail(d.db, j.id, e); })
    .finally(() => {
      if (!live()) return;
      st.watchers.delete(j.id);
      void drainQueue(d);
    });
}

async function finish(d: Deps, j: Job, base: string, files: OutFile[], since: number, live: () => boolean): Promise<void> {
  const stamp = new Date(d.now()).toISOString().replace(/\D/g, "").slice(0, 14);
  const isPoster = (f: OutFile) => f.filename.startsWith("studio-last");
  const save = async (f: OutFile, stem: string, ext: string) => {
    const name = freeName(d.dir, stem, ext);
    writeAtomic(path.join(d.dir, name), await d.client.fetchOutput(base, f));
    return name;
  };

  if (j.kind === "pose") {
    const img = files.find((f) => /\.png$/i.test(f.filename)) ?? fail2("ComfyUI finished without an image.");
    const image = await save(img, `poseprep-${stamp}`, ".png");
    let keypoints: unknown = null;
    if ((j.recipe as PoseJob).kind === "pose") {
      const h = (await d.client.history(base, j.promptId!)) as Record<string, any>;
      const raw = h?.[j.promptId!]?.outputs?.pose?.openpose_json?.[0];
      if (typeof raw === "string") keypoints = (JSON.parse(raw) as unknown[])[0] ?? null;
    }
    if (!live()) return;
    updateJob(d.db, j.id, { status: "done", progress: 1, recipe: { ...(j.recipe as object), result: { image, keypoints } } });
    return;
  }

  const clip = j.kind === "video";
  const seed = Number((j.recipe as { seed?: number }).seed) || 0;
  const main = files.find((f) => (clip ? /\.mp4$/i.test(f.filename) : /\.png$/i.test(f.filename) && !isPoster(f)))
    ?? fail2(clip ? "ComfyUI finished without a clip." : "ComfyUI finished without an image.");
  const file = await save(main, `${stamp}-${seed}`, clip ? ".mp4" : ".png");
  let poster: string | null = null;
  const pf = clip ? files.find(isPoster) : undefined;
  if (pf) {
    poster = file.replace(/\.mp4$/, "-last.png");
    writeAtomic(path.join(d.dir, poster), await d.client.fetchOutput(base, pf));
  }
  if (!live()) return; // timed out meanwhile: the files are orphaned, the job already says error
  const cost = (d.eng.view()[j.card].usdHr * (d.now() - since)) / 3_600_000;
  const itemId = addItem(d.db, { kind: clip ? "clip" : "photo", file, poster, recipe: j.recipe, seed, cost, createdAt: d.now() });
  updateJob(d.db, j.id, { status: "done", progress: 1, itemId });
}

const fail2 = (m: string): never => { throw new Error(m); };

function freeName(dir: string, stem: string, ext: string): string {
  let name = stem + ext;
  for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

function writeAtomic(file: string, buf: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** listModels for the routes, cached 60 s per pod. drainQueue always asks fresh. */
const modelCache = new Map<string, { at: number; m: Models }>();
export async function cachedModels(base: string, now = Date.now()): Promise<Models> {
  const hit = modelCache.get(base);
  if (hit && now - hit.at < 60_000) return hit.m;
  const m = await listModels(base);
  modelCache.set(base, { at: now, m });
  return m;
}
