import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "../env";
import { SSH_OPTS, podHost } from "./pod";

/** LoRAs imported from the phone. Kept on the Mac; copied to the main pod's persistent models volume. */
export const LORA_DIR = path.join(DATA_DIR, "comfy-loras");
const MAX_BYTES = 2 * 1024 ** 3;
const REMOTE = "/opt/comfy/models/loras";

export class LoraError extends Error {}

/** A plain file name ending in .safetensors (no quotes or slashes, so it is safe inside '…' over ssh). */
export const loraName = (n: string): string | null => (/^\w[\w .()+-]{0,120}\.safetensors$/.test(n) ? n : null);

/** A safetensors file opens with an 8-byte little-endian header length, then that much JSON. */
export function isSafetensors(head: Buffer, size: number): boolean {
  if (head.length < 9) return false;
  const n = Number(head.readBigUInt64LE(0));
  return n > 1 && n < 100_000_000 && n + 8 <= size && head[8] === 0x7b;
}

export async function listLoras(dir = LORA_DIR): Promise<{ name: string; bytes: number }[]> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const out = [];
  for (const name of names.filter((n) => loraName(n))) out.push({ name, bytes: (await fsp.stat(path.join(dir, name))).size });
  return out;
}

/** Streams an upload to disk (never buffered whole), then checks it really is a safetensors file. */
export async function saveLora(name: string, body: ReadableStream<Uint8Array>, dir = LORA_DIR): Promise<number> {
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${name}.part`);
  let bytes = 0;
  const count = new Transform({ transform(c: Buffer, _e, cb) { bytes += c.length; cb(bytes > MAX_BYTES ? new LoraError("LoRAs over 2 GB aren't supported.") : null, c); } });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), count, fs.createWriteStream(tmp));
    const fd = await fsp.open(tmp);
    const { buffer } = await fd.read(Buffer.alloc(9), 0, 9, 0).finally(() => fd.close());
    if (!isSafetensors(buffer, bytes)) throw new LoraError("That isn't a .safetensors LoRA.");
    await fsp.rename(tmp, path.join(dir, name));
    return bytes;
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

export function ssh(host: string, cmd: string, stdin?: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("ssh", [...SSH_OPTS, `root@${host}`, cmd]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ssh exited ${code}: ${out.slice(-500)}`))));
    if (stdin) stdin.on("error", reject).pipe(p.stdin);
    else p.stdin.end();
  });
}

/** Copies imports the main pod lacks (by size) onto its models volume. Returns the names sent. */
export async function pushLoras(host = podHost("main"), dir = LORA_DIR): Promise<string[]> {
  const mine = await listLoras(dir);
  if (!mine.length) return [];
  const have = new Map((await ssh(host, `mkdir -p ${REMOTE} && cd ${REMOTE} && stat -c '%s %n' -- *.safetensors 2>/dev/null || true`))
    .split("\n").map((l) => l.match(/^(\d+) (.+)$/)).filter((m) => m !== null).map((m) => [m[2], Number(m[1])]));
  const sent = [];
  for (const { name, bytes } of mine) {
    if (have.get(name) === bytes) continue;
    await ssh(host, `cat > '${REMOTE}/.${name}.part' && mv '${REMOTE}/.${name}.part' '${REMOTE}/${name}'`, fs.createReadStream(path.join(dir, name)));
    sent.push(name);
  }
  return sent;
}

/** Wan LoRAs touch `blocks.N.self_attn|cross_attn|ffn`; Qwen (`transformer_blocks`) and SDXL (`down_blocks`) never do. */
export const isWanLora = (keys: string[]): boolean => keys.some((k) => /(^|[._])blocks[._]\d+[._](self_attn|cross_attn|ffn)/.test(k) && !/transformer_blocks|down_blocks|up_blocks|mid_block/.test(k));

const KEYS_PY = `import json,struct,glob,os
o={}
for f in glob.glob("${REMOTE}/**/*.safetensors",recursive=True):
  try:
    with open(f,"rb") as h: n=struct.unpack("<Q",h.read(8))[0]; o[os.path.relpath(f,"${REMOTE}")]=sorted(json.loads(h.read(n)))[:40]
  except Exception: pass
print(json.dumps(o))`;
const wan = new Map<string, boolean>();

/** Of the pod's LoRAs, the ones a Wan video can use (unreadable files are kept, image LoRAs dropped). A Qwen LoRA on Wan silently loads nothing. */
export async function videoLoras(names: string[], host = podHost("main")): Promise<string[]> {
  if (names.some((n) => !wan.has(n))) {
    try {
      const keys = JSON.parse((await ssh(host, "python3 -", Readable.from([KEYS_PY]))).trim().split("\n").pop() ?? "{}") as Record<string, string[]>;
      for (const [n, k] of Object.entries(keys)) wan.set(n, isWanLora(k));
      for (const n of names) if (!wan.has(n)) wan.set(n, true);
    } catch { /* pod unreachable: show everything */ }
  }
  return names.filter((n) => wan.get(n) !== false);
}
