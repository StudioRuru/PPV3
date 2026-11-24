import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import YAML from "yaml";
import type { Card } from "./store";

export const COMFY_PORT = 8188;
/** Pods are rebuilt with new host keys; LogLevel=ERROR keeps the "Permanently added" warning out of captured output. */
export const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"];
export type ManifestEntry = { kind: string; filename: string; sha256: string; size: number; urls: string[]; licence: string; cards: Card[] };

const POD_DIR = path.join(process.cwd(), "pod", "comfy");
const KINDS = new Set(["checkpoints", "controlnet", "diffusion_models", "vae", "text_encoders", "loras", "dwpose", "depth", "rife", "ultralytics/bbox"]);
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

/**
 * The tailnet IP of the online node that asked for `host`. A flushed pod's stale node keeps the bare MagicDNS
 * name and the new pod becomes "<host>-1", so match on the requested HostName, not DNS. Null if none is online.
 */
export async function tailnetIp(host: string, status: () => Promise<string> = tsStatus): Promise<string | null> {
  const peers = Object.values((JSON.parse(await status()) as { Peer?: Record<string, { HostName: string; Online: boolean; TailscaleIPs?: string[] }> }).Peer ?? {});
  return peers.find((p) => p.HostName === host && p.Online)?.TailscaleIPs?.[0] ?? null;
}
const tsStatus = () => new Promise<string>((resolve, reject) =>
  execFile(process.env.TAILSCALE_BIN || "/usr/local/bin/tailscale", ["status", "--json"], { timeout: 10_000 }, (e, out) => (e ? reject(e) : resolve(out))));

export type Run = (cmd: string, args: string[], stdin: string) => Promise<string>;
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

/** The pod's tailnet IP when known: the MagicDNS name goes stale after a flush ("Could not resolve hostname"). */
export const hostFor = (card: Card, ip?: string | null) => ip || podHost(card);

/** Pushes the card's manifest to the pod over Tailscale SSH and downloads any missing models. Returns the script's stdout. */
export function syncModels(card: Card, host: string, run: Run = sshRun): Promise<string> {
  return run("ssh", [...SSH_OPTS, `root@${host}`, "bash", "/opt/comfy/fetch-models.sh"], forCard(card));
}

/** Stops comfy, kills anything else on the volume (an in-flight model sync) and unmounts it so hibernate's detach doesn't yank a mounted filesystem. */
export async function releaseModels(card: Card, host: string, run: Run = sshRun): Promise<void> {
  await run("ssh", [...SSH_OPTS, "-o", "ConnectTimeout=15", `root@${host}`, "systemctl stop comfy; fuser -km /opt/comfy/models; sync; umount /opt/comfy/models"], "");
}

const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SSH_WAIT = [5_000, 10_000, 20_000, 40_000, 40_000, 40_000]; // ~2.6 min for sshd after the tailnet comes up

/** Resolves once sshd answers; sync used to fire before it was up. */
export async function waitSsh(host: string, run: Run = sshRun, sleep: (ms: number) => Promise<void> = nap): Promise<void> {
  for (let i = 0; i <= SSH_WAIT.length; i++) {
    try { await run("ssh", [...SSH_OPTS, "-o", "ConnectTimeout=10", `root@${host}`, "true"], ""); return; } catch { if (i < SSH_WAIT.length) await sleep(SSH_WAIT[i]); }
  }
  throw new Error(`SSH never answered on ${host}`);
}

/** A transport failure worth retrying. A `FAILED kind/name` download from fetch-models.sh is not one. */
export const isNetError = (e: unknown): boolean => !/FAILED /.test(String((e as Error)?.message ?? e)) && /Could not resolve hostname|Connection (timed out|refused|reset)|port 22|kex_exchange|Broken pipe/i.test(e instanceof Error ? e.message : String(e));

export async function withRetry<T>(fn: () => Promise<T>, isNet: (e: unknown) => boolean, sleep: (ms: number) => Promise<void> = nap, delays = [10_000, 30_000]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= delays.length || !isNet(e)) throw e; await sleep(delays[i]); }
  }
}

export const fetchedCount = (stdout: string): number => stdout.split("\n").filter((l) => l.startsWith("get ")).length;

/** Files on the pod's models volume as `kind/filename` + bytes. */
export async function listVolume(host: string, run: Run = sshRun): Promise<{ name: string; size: number }[]> {
  const out = await run("ssh", [...SSH_OPTS, `root@${host}`, "find /opt/comfy/models -type f -printf '%P %s\\n'"], "");
  return out.split("\n").flatMap((l) => { const m = l.match(/^(.+) (\d+)$/); return m ? [{ name: m[1], size: Number(m[2]) }] : []; });
}
