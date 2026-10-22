import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "../env";
import { LORA_DIR, ssh } from "./loras";
import { podHost } from "./pod";

/** One LoRA training run at a time, on the main pod, with ostris/ai-toolkit (installed by pod/comfy/install.sh). */
export type Arch = "sdxl" | "qwen";
export type TrainKind = "face" | "scene";
export type Run = { id: string; name: string; arch: Arch; kind: TrainKind; steps: number; startedAt: number; done?: boolean; error?: string };

const STATE = path.join(DATA_DIR, "comfy-train.json");
const TOOLKIT = "/opt/ai-toolkit";
const LORAS = "/opt/comfy/models/loras";
const BASE: Record<Arch, string> = {
  sdxl: "/opt/comfy/models/checkpoints/waiIllustriousSDXL_v170.safetensors",
  qwen: "/opt/comfy/models/train-base/qwen-image-2.1",
};
export const STEPS: Record<Arch, number> = { sdxl: 2000, qwen: 1500 };
export const MIN_IMAGES = 5, MAX_IMAGES = 40;
const MAX_MS = 4 * 3600_000;

/** Plain lowercase name (also the LoRA's file name and trigger word). */
export const trainName = (n: string): string | null => (/^[a-z][a-z0-9_]{2,40}$/.test(n) ? n : null);

export function caption(kind: TrainKind, trigger: string): string {
  return kind === "face" ? `${trigger}, photo of a person` : trigger;
}

/** AI-Toolkit job config. JSON is valid YAML, so it is written as config.yaml without a YAML dependency. */
export function buildConfig(r: { id: string; name: string; arch: Arch; steps: number }): string {
  const dir = `/opt/train/${r.id}`;
  return JSON.stringify({
    job: "extension",
    config: {
      name: r.name,
      process: [{
        type: "sd_trainer",
        training_folder: `${dir}/out`,
        device: "cuda:0",
        trigger_word: r.name,
        network: { type: "lora", linear: 16, linear_alpha: 16 },
        save: { dtype: "float16", save_every: r.steps, max_step_saves_to_keep: 1 },
        datasets: [{ folder_path: `${dir}/data`, caption_ext: "txt", caption_dropout_rate: 0.05, cache_latents_to_disk: true, resolution: [512, 768, 1024] }],
        train: {
          batch_size: 1, steps: r.steps, gradient_accumulation_steps: 1, train_unet: true, train_text_encoder: false,
          gradient_checkpointing: true, noise_scheduler: r.arch === "sdxl" ? "ddpm" : "flowmatch", optimizer: "adamw8bit", lr: 1e-4, dtype: "bf16",
          ...(r.arch === "qwen" ? { cache_text_embeddings: true } : {}),
        },
        model: r.arch === "sdxl"
          ? { name_or_path: BASE.sdxl, arch: "sdxl" }
          : { name_or_path: BASE.qwen, arch: "qwen_image_2", quantize: true, qtype: "qfloat8", quantize_te: true, qtype_te: "qfloat8" },
        sample: { sampler: r.arch === "sdxl" ? "ddpm" : "flowmatch", sample_every: r.steps + 1, width: 1024, height: 1024, prompts: [r.name], neg: "", seed: 42, walk_seed: false, guidance_scale: 4, sample_steps: 20 },
      }],
    },
  }, null, 2);
}

/** Last "x/y" from tqdm output (ai-toolkit prints `name:  12%|█ | 240/2000 [..]`). */
export function parseProgress(log: string, steps: number): number {
  const m = [...log.matchAll(/(\d+)\/(\d+) \[/g)].filter((x) => Number(x[2]) === steps).pop();
  return m ? Math.min(1, Number(m[1]) / steps) : 0;
}

export function readRun(file = STATE): Run | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Run; } catch { return null; }
}
const writeRun = (r: Run, file = STATE) => fs.writeFileSync(file, JSON.stringify(r));
/** The engine treats an active run like a running job: no idle hibernate. */
export const training = (): boolean => { const r = readRun(); return !!r && !r.done && !r.error; };

function tarTo(host: string, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = spawn("tar", ["-C", local, "-cf", "-", "."]);
    t.on("error", reject);
    ssh(host, `mkdir -p '${remote}' && tar -C '${remote}' -xf -`, t.stdout).then(() => resolve(), reject);
  });
}

export async function startTrain(o: { name: string; arch: Arch; kind: TrainKind; images: Buffer[] }, host = podHost("main")): Promise<Run> {
  if (training()) throw new Error("A LoRA is already training.");
  const run: Run = { id: `${Date.now()}`, name: o.name, arch: o.arch, kind: o.kind, steps: STEPS[o.arch], startedAt: Date.now() };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "train-"));
  try {
    await fsp.mkdir(path.join(tmp, "data"));
    for (const [i, b] of o.images.entries()) {
      await fsp.writeFile(path.join(tmp, "data", `${i}.png`), b);
      await fsp.writeFile(path.join(tmp, "data", `${i}.txt`), caption(o.kind, o.name));
    }
    await fsp.writeFile(path.join(tmp, "config.yaml"), buildConfig(run));
    await tarTo(host, tmp, `/opt/train/${run.id}`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  const dir = `/opt/train/${run.id}`;
  const out = `${dir}/out/${run.name}/${run.name}.safetensors`;
  await ssh(host, `systemd-run --unit train-${run.id} -p WorkingDirectory=${TOOLKIT} -p StandardOutput=file:${dir}/log -p StandardError=file:${dir}/log ` +
    `sh -c '${TOOLKIT}/venv/bin/python run.py ${dir}/config.yaml && cp ${out} ${LORAS}/${run.name}.safetensors'`);
  writeRun(run);
  return run;
}

/** Polls the pod; when the run ends, copies the LoRA back to the Mac so pushLoras restores it on a fresh pod. */
export async function trainStatus(host = podHost("main")): Promise<(Run & { progress: number }) | null> {
  const run = readRun();
  if (!run || run.done || run.error) return run && { ...run, progress: run.done ? 1 : 0 };
  const out = await ssh(host, `systemctl is-active train-${run.id} || true; echo ---; tail -c 6000 /opt/train/${run.id}/log 2>/dev/null || true`);
  const [state, log] = out.split("\n---\n");
  if (Date.now() - run.startedAt > MAX_MS && state.trim() === "active") {
    // ponytail: hard 4 h cap so a hung run can't keep the GPU billing; make it per-arch if real runs get close
    await ssh(host, `systemctl stop train-${run.id} || true`);
    run.error = "Training ran over 4 hours and was stopped.";
    writeRun(run);
    return { ...run, progress: 0 };
  }
  const progress = parseProgress(log ?? "", run.steps);
  if (state.trim() === "active" || state.trim() === "activating") return { ...run, progress };
  const lora = `${LORAS}/${run.name}.safetensors`;
  try {
    await fsp.mkdir(LORA_DIR, { recursive: true });
    const part = path.join(LORA_DIR, `.${run.name}.safetensors.part`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", `root@${host}`, `cat '${lora}'`]);
      p.stdout.pipe(fs.createWriteStream(part));
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("no LoRA"))));
    });
    await fsp.rename(part, path.join(LORA_DIR, `${run.name}.safetensors`));
    run.done = true;
  } catch {
    run.error = (log ?? "").trim().split("\n").slice(-3).join("\n").slice(-400) || "Training stopped without a LoRA.";
  }
  writeRun(run);
  return { ...run, progress: run.done ? 1 : progress };
}
