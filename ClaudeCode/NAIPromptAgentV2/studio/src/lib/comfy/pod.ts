import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import YAML from "yaml";
import type { Card } from "./store";

export const COMFY_PORT = 8188;
export type ManifestEntry = { kind: string; filename: string; sha256: string; size: number; urls: string[]; licence: string; cards: Card[] };

const POD_DIR = path.join(process.cwd(), "pod", "comfy");
const KINDS = new Set(["checkpoints", "controlnet", "diffusion_models", "vae", "text_encoders", "loras", "dwpose", "depth", "rife"]);
const b64 = (s: string) => Buffer.from(s).toString("base64");

export const podHost = (card: Card) => `nai-comfy-${card}`;
/** Main's models (~82 GB) overflow the 100 GB root disk, so they live on a persistent volume that survives Flush. Boost fits on root. */
export const modelsVolume = (card: Card) => (card === "main" ? { name: `${podHost(card)}-models`, gb: 150 } : null);

export function readManifest(file = path.join(POD_DIR, "models.manifest.yaml")): ManifestEntry[] {
  const list = YAML.parse(fs.readFileSync(file, "utf8")) as ManifestEntry[];
  if (!Array.isArray(list)) throw new Error("manifest must be a list");
  for (const e of list) {
    if (!e || typeof e !== "object") throw new Error("manifest entry must be an object");
    const bad = (why: string) => new Error(`manifest ${e?.filename}: ${why}`);
    if (!KINDS.has(e.kind)) throw bad(`unknown kind ${e.kind}`);
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) throw bad("sha256 must be 64 lowercase hex");
    if (!/^[\w.-]+$/.test(e.filename)) throw bad("bad filename");
    if (!Array.isArray(e.urls) || !e.urls.length || !e.urls.every((u) => u.startsWith("https://"))) throw bad("urls must be https");
    if (!(e.size > 0) || !e.licence || !Array.isArray(e.cards) || !e.cards.length) throw bad("size, licence and cards required");
    if (!e.cards.every((c) => c === "main" || c === "boost")) throw bad("cards must be main or boost");
  }
  return list;
}

const forCard = (card: Card) => YAML.stringify(readManifest().filter((e) => e.cards.includes(card)));

/** Renders cloud-init user-data. Contains secrets: never log it or write it to disk. */
export function renderCloudInit(card: Card, secrets: { tsAuthKey: string; hfToken: string; civitaiToken: string }): string {
  for (const v of Object.values(secrets)) if (/['\r\n]/.test(v)) throw new Error("secret contains a quote or newline");
  const read = (f: string) => fs.readFileSync(path.join(POD_DIR, f), "utf8");
  const vars: Record<string, string> = {
    TS_AUTHKEY: secrets.tsAuthKey, HOSTNAME: podHost(card), HF_TOKEN: secrets.hfToken, CIVITAI_TOKEN: secrets.civitaiToken,
    MODELS_GB: String(modelsVolume(card)?.gb ?? ""), INSTALL_B64: b64(read("install.sh")), FETCH_B64: b64(read("fetch-models.sh")), MANIFEST_B64: b64(forCard(card)),
  };
  return Object.entries(vars).reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), read("cloud-init.yaml"));
}

type Run = (cmd: string, args: string[], stdin: string) => Promise<string>;
const sshRun: Run = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ssh exited ${code}: ${out.slice(-500)}`))));
    p.stdin.end(stdin);
  });

/** Pushes the card's manifest to the pod over Tailscale SSH and downloads any missing models. */
export function syncModels(card: Card, run: Run = sshRun): Promise<string> {
  return run("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", `root@${podHost(card)}`, "bash", "/opt/comfy/fetch-models.sh"], forCard(card));
}
