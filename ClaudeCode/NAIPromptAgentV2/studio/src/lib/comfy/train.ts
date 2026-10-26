import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "../env";
import { LORA_DIR, ssh } from "./loras";
import { SSH_OPTS, podHost } from "./pod";

/** One LoRA training run at a time, on the main pod, with ostris/ai-toolkit (installed by pod/comfy/install.sh). */
export type Arch = "sdxl" | "qwen" | "moss" | "wan22";
export type TrainKind = "face" | "scene";
export type Run = { id: string; name: string; arch: Arch; kind: TrainKind; steps: number; startedAt: number; done?: boolean; error?: string };

const STATE = path.join(DATA_DIR, "comfy-train.json");
const TOOLKIT = "/opt/ai-toolkit";
const LORAS = "/opt/comfy/models/loras";
/** AI-Toolkit arch ids (pod recon 2026-10-25). */
export const AIT_ARCH: Record<Exclude<Arch, "sdxl">, string> = { qwen: "qwen_image_2", moss: "moss_image", wan22: "wan22_14b_i2v" };
/** Pose images come from MOSS: it trains from local pod files, no Klein download. */
export const POSE_FAMILY = "moss" as const;
const BASE: Record<"sdxl" | "qwen", string> = {
  sdxl: "/opt/comfy/models/checkpoints/waiIllustriousSDXL_v170.safetensors",
  qwen: "/opt/comfy/models/train-base/qwen-image-2.1",
};
// ponytail: moss/wan22 step counts are first guesses; tune from the first run
export const STEPS: Record<Arch, number> = { sdxl: 2000, qwen: 1500, moss: 1500, wan22: 2000 };
export const MIN_IMAGES = 5, MAX_IMAGES = 40;
/** Wan trains for hours (first run also downloads the base), so it gets a longer cap. */
const maxMs = (a: Arch) => (a === "wan22" ? 8 : 4) * 3600_000;

/** Plain lowercase name (also the LoRA's file name and trigger word). */
export const trainName = (n: string): string | null => (/^[a-z][a-z0-9_]{2,40}$/.test(n) ? n : null);

export function caption(kind: TrainKind, trigger: string): string {
  return kind === "face" ? `${trigger}, photo of a person` : trigger;
}

/** One `.txt` per image, paired by index. */
export function captionFiles(images: string[], captions: string[]): [string, string][] {
  if (captions.length !== images.length) throw new Error("Need one caption per image.");
  return images.map((f, i) => [f.replace(/\.[^.]+$/, ".txt"), captions[i]]);
}

/** Final LoRAs only: AI-Toolkit step saves look like NAME_000005000.safetensors (Wan: NAME_000005000_high_noise.safetensors). */
export const finalLoras = (files: string[]): string[] => files.filter((f) => f.endsWith(".safetensors") && !/_\d{9}(_(high|low)_noise)?\.safetensors$/.test(f));

const MODEL = (a: Arch): object =>
  a === "sdxl" ? { name_or_path: BASE.sdxl, arch: "sdxl" }
  : a === "qwen" ? { name_or_path: BASE.qwen, arch: AIT_ARCH.qwen, quantize: true, qtype: "qfloat8", quantize_te: true, qtype_te: "qfloat8" }
  : a === "moss" ? {
    name_or_path: "/opt/comfy/models/diffusion_models/pornmasterMoss_v1.safetensors", arch: AIT_ARCH.moss,
    te_name_or_path: "/opt/comfy/models/text_encoders/qwen3.5_9b_int8_convrot.safetensors", vae_path: "/opt/comfy/models/vae/flux2-vae.safetensors",
  }
  : { name_or_path: "ai-toolkit/Wan2.2-I2V-A14B-Diffusers-bf16", arch: AIT_ARCH.wan22, quantize: true, quantize_te: true, low_vram: true, model_kwargs: { train_high_noise: true, train_low_noise: true } };

/** AI-Toolkit job config. JSON is valid YAML, so it is written as config.yaml without a YAML dependency. */
export function buildConfig(r: { id: string; name: string; arch: Arch; steps: number }): string {
  const dir = `/opt/train/${r.id}`;
  const wan = r.arch === "wan22";
  return JSON.stringify({
    job: "extension",
    config: {
      name: r.name,
      process: [{
        type: "sd_trainer",
        training_folder: `${dir}/out`,
        device: "cuda:0",
        trigger_word: r.name,
        network: { type: "lora", linear: wan ? 32 : 16, linear_alpha: wan ? 32 : 16 },
        save: { dtype: "float16", save_every: wan ? 500 : r.steps, max_step_saves_to_keep: wan ? 2 : 1 },
        datasets: [{ folder_path: `${dir}/data`, caption_ext: "txt", caption_dropout_rate: 0.05, cache_latents_to_disk: true, ...(wan ? { resolution: [512, 768], num_frames: 1 } : { resolution: [512, 768, 1024] }) }],
        train: {
          batch_size: 1, steps: r.steps, gradient_accumulation_steps: 1, train_unet: true, train_text_encoder: false,
          gradient_checkpointing: true, noise_scheduler: r.arch === "sdxl" ? "ddpm" : "flowmatch", optimizer: "adamw8bit", lr: 1e-4, dtype: "bf16",
          ...(r.arch === "qwen" ? { cache_text_embeddings: true } : {}),
          ...(r.arch === POSE_FAMILY || wan ? { disable_sampling: true } : {}),
        },
        model: MODEL(r.arch),
        // ponytail: wan22 sample uses the first training image as ctrl_img (i2v needs a first frame); sampling is disabled via train.disable_sampling (sample_every > steps is the fallback)
        sample: { sampler: r.arch === "sdxl" ? "ddpm" : "flowmatch", sample_every: r.steps + 1, width: 1024, height: 1024, ...(wan ? { samples: [{ prompt: r.name, ctrl_img: `${dir}/data/0.png` }] } : { prompts: [r.name] }), neg: "", seed: 42, walk_seed: false, guidance_scale: 4, sample_steps: 20 },
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

export async function startTrain(o: { name: string; arch: Arch; kind: TrainKind; images: Buffer[]; captions?: string[] }, host = podHost("main")): Promise<Run> {
  if (training()) throw new Error("A LoRA is already training.");
  const run: Run = { id: `${Date.now()}`, name: o.name, arch: o.arch, kind: o.kind, steps: STEPS[o.arch], startedAt: Date.now() };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "train-"));
  try {
    await fsp.mkdir(path.join(tmp, "data"));
    const names = o.images.map((_, i) => `${i}.png`);
    const txt = o.captions ? captionFiles(names, o.captions) : names.map((n): [string, string] => [n.replace(".png", ".txt"), caption(o.kind, o.name)]);
    for (const [i, b] of o.images.entries()) await fsp.writeFile(path.join(tmp, "data", names[i]), b);
    for (const [f, c] of txt) await fsp.writeFile(path.join(tmp, "data", f), c);
    await fsp.writeFile(path.join(tmp, "config.yaml"), buildConfig(run));
    await tarTo(host, tmp, `/opt/train/${run.id}`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  const dir = `/opt/train/${run.id}`;
  const out = `${dir}/out/${run.name}`;
  await ssh(host, `systemd-run --unit train-${run.id} -p WorkingDirectory=${TOOLKIT} -p StandardOutput=file:${dir}/log -p StandardError=file:${dir}/log ` +
    `sh -c '${TOOLKIT}/venv/bin/python run.py ${dir}/config.yaml && find ${out} -regextype posix-extended -name "*.safetensors" ! -regex ".*_[0-9]{9}(_(high|low)_noise)?\\.safetensors" -exec cp {} ${LORAS}/ \\;'`);
  writeRun(run);
  return run;
}

/** Polls the pod; when the run ends, copies the LoRA back to the Mac so pushLoras restores it on a fresh pod. */
export async function trainStatus(host = podHost("main")): Promise<(Run & { progress: number }) | null> {
  const run = readRun();
  if (!run || run.done || run.error) return run && { ...run, progress: run.done ? 1 : 0 };
  const out = await ssh(host, `systemctl is-active train-${run.id} || true; echo ---; tail -c 6000 /opt/train/${run.id}/log 2>/dev/null || true`);
  const [state, log] = out.split("\n---\n");
  if (Date.now() - run.startedAt > maxMs(run.arch) && state.trim() === "active") {
    // ponytail: hard cap (4 h, 8 h for Wan) so a hung run can't keep the GPU billing; tune from real run times
    await ssh(host, `systemctl stop train-${run.id} || true`);
    run.error = `Training ran over ${maxMs(run.arch) / 3600_000} hours and was stopped.`;
    writeRun(run);
    return { ...run, progress: 0 };
  }
  const progress = parseProgress(log ?? "", run.steps);
  if (state.trim() === "active" || state.trim() === "activating") return { ...run, progress };
  try {
    await fsp.mkdir(LORA_DIR, { recursive: true });
    const files = finalLoras((await ssh(host, `ls '/opt/train/${run.id}/out/${run.name}'`)).split("\n").map((s) => s.trim()));
    if (!files.length) throw new Error("no LoRA");
    for (const f of files) {
      const part = path.join(LORA_DIR, `.${f}.part`);
      await new Promise<void>((resolve, reject) => {
        const p = spawn("ssh", [...SSH_OPTS, `root@${host}`, `cat '${LORAS}/${f}'`]);
        p.stdout.pipe(fs.createWriteStream(part));
        p.on("error", reject);
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("no LoRA"))));
      });
      await fsp.rename(part, path.join(LORA_DIR, f));
    }
    run.done = true;
  } catch {
    run.error = (log ?? "").trim().split("\n").slice(-3).join("\n").slice(-400) || "Training stopped without a LoRA.";
  }
  writeRun(run);
  return { ...run, progress: run.done ? 1 : progress };
}
