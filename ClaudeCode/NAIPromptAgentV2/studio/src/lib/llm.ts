import { spawn } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { BRAIN_MODEL, CAPTION_URL, KOBOLD_BIN, KOBOLD_MODEL, KOBOLD_URL, OLLAMA_URL, RP_POD_URL, TIPO_URL } from "./env";
import type { ChatMsg } from "./copilot-prompt";
import { HeavyGate } from "./tiers";

export class Offline extends Error {}

/** Any upload → ≤1 Mpx JPEG data URL (ToriiGate's training resolution). Throws on non-images. */
export async function toModelImage(buf: Buffer): Promise<string> {
  const img = sharp(buf).rotate();
  const { width = 0, height = 0, orientation = 1 } = await img.metadata();
  if (!width || !height) throw new Error("not an image");
  const scale = Math.min(1, Math.sqrt(1_048_576 / (width * height)));
  // metadata() reports stored dimensions; EXIF 5-8 means rotate() swaps them. Width-only resize keeps the aspect.
  const outW = orientation >= 5 ? height : width;
  const out = await img.resize({ width: Math.floor(outW * scale) }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function post(url: string, body: unknown, ms: number): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  } catch {
    throw new Offline(url);
  }
}

export async function ping(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
}

export const brainUp = () => ping(`${OLLAMA_URL}/api/version`);
export const captionUp = () => ping(`${CAPTION_URL}/health`);
export const tipoUp = () => ping(`${TIPO_URL}/health`);

export async function brainLoaded(): Promise<boolean> {
  const r = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json(), () => null);
  return !!r?.models?.some((m: { name: string }) => m.name === BRAIN_MODEL);
}

/** Load (keep resident) or unload the brain. */
export async function setBrain(on: boolean): Promise<void> {
  const r = await post(`${OLLAMA_URL}/api/generate`, { model: BRAIN_MODEL, prompt: "", keep_alive: on ? "2h" : 0 }, 120_000);
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
}

/** Runs scripts/power.sh detached (own process group, so servers outlive a Ctrl-C on the dev server). */
export function power(action: "up" | "down" | "status"): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    const p = spawn("bash", [path.join(process.cwd(), "scripts/power.sh"), action], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ ok: false, err: e.message }));
    p.on("close", (code) => resolve({ ok: code === 0, err: err.trim() }));
  });
}

/** Unload every resident Ollama model except the everyday brain (the heavy one, before servers restart). */
async function unloadOthers(): Promise<void> {
  const ps = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json(), () => null);
  for (const m of (ps?.models ?? []) as { name: string }[]) {
    if (m.name !== BRAIN_MODEL) await post(`${OLLAMA_URL}/api/generate`, { model: m.name, prompt: "", keep_alive: 0 }, 60_000).catch(() => null);
  }
  await stopKobold();
}

// --moecpu 4: Omega Q4_K_M runs out of GPU memory fully offloaded (18 GB Metal limit on 24 GB); 4 MoE layers on the CPU fix it.
/** KoboldCpp holds its whole model while it runs, so it's started for a kobold: reply and stopped when the gate restores. */
async function ensureKobold(): Promise<void> {
  if (await ping(`${KOBOLD_URL}/v1/models`)) return;
  const { port, hostname } = new URL(KOBOLD_URL);
  spawn(KOBOLD_BIN, ["--model", KOBOLD_MODEL, "--host", hostname, "--port", port, "--contextsize", "16384", "--jinja", "--jinjathink", "false", "--moecpu", "4", "--skiplauncher", "--quiet"],
    { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await ping(`${KOBOLD_URL}/v1/models`)) return;
  }
  throw new Error("KoboldCpp didn't start within 3 minutes");
}

// ponytail: matches by binary path, so a Kobold the owner started by hand is stopped too.
export const stopKobold = () => new Promise<void>((resolve) => spawn("pkill", ["-f", KOBOLD_BIN]).on("close", () => resolve()).on("error", () => resolve()));

/** One shared pause for heavy-model calls (see HeavyGate). On globalThis so a dev hot-reload doesn't forget a pause. */
const g = globalThis as unknown as { __heavyGate?: HeavyGate };
export const heavyGate = (g.__heavyGate ??= new HeavyGate({
  power,
  active: async () => (await Promise.all([captionUp(), tipoUp(), brainLoaded()])).some(Boolean),
  unloadHeavy: unloadOthers,
}));
const paused = (what: string) => new Error(`${what} is paused while the heavy model is replying — try again in a moment`);

export type StreamOpts = { model?: string; options?: Record<string, unknown>; stop?: string[]; system?: boolean; think?: false };

/**
 * Streams reply text chunks; thinking tokens are skipped. Without `opts.model` it's the everyday brain (servers
 * restored first if the heavy gate paused them); heavy callers wrap this in `heavyGate.run`.
 * `system: false` sends `messages` as-is (RP assembles its own system turns).
 */
/** Ollama /api/chat body. Heavy calls (explicit model) turn thinking off: APEX would otherwise think away the whole reply budget. */
export function chatBody(system: string, messages: ChatMsg[] | { role: string; content: string }[], opts: StreamOpts = {}): Record<string, unknown> {
  return {
    model: opts.model ?? BRAIN_MODEL, stream: true, keep_alive: opts.model ? "30m" : "2h",
    ...(opts.model || opts.think === false ? { think: false } : {}),
    messages: opts.system === false ? messages : [{ role: "system", content: system }, ...messages],
    options: { temperature: 0.6, top_k: 64, top_p: 0.9, min_p: 0.05, repeat_penalty: 1.1, num_ctx: 16384, ...opts.options, ...(opts.stop?.length ? { stop: opts.stop } : {}) },
  };
}

/** A model served by the rented RP pod rather than the Mac's Ollama. */
export const isPod = (model?: string) => !!model?.startsWith("pod:");
/** A model on the Mac's KoboldCpp: same OpenAI API as the pod, but local, so it still takes the heavy gate. */
export const isKobold = (model?: string) => !!model?.startsWith("kobold:");
// DRY (repetition of phrases, not tokens) — the reason to run Kobold at all; a chat's own options override it.
const KOBOLD_DEFAULTS = { dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2 };

/** OpenAI-style body for llama-server; Ollama option names map over, and llama.cpp-only samplers (dry_*, xtc_*) pass through. */
export function podBody(messages: { role: string; content: string }[], model: string, options: Record<string, unknown> = {}, stop?: string[]): Record<string, unknown> {
  const { num_predict, num_ctx: _ctx, ...rest } = options;
  return { model: model.slice(model.indexOf(":") + 1), stream: true, messages, ...(isKobold(model) ? KOBOLD_DEFAULTS : {}), ...rest, ...(num_predict ? { max_tokens: num_predict } : {}), ...(stop?.length ? { stop } : {}) };
}

async function* podStream(messages: { role: string; content: string }[], opts: StreamOpts): AsyncGenerator<string> {
  const r = await post(`${isKobold(opts.model) ? KOBOLD_URL : RP_POD_URL}/v1/chat/completions`, podBody(messages, opts.model!, opts.options, opts.stop), 600_000);
  if (!r.ok || !r.body) throw new Error(`${isKobold(opts.model) ? "KoboldCpp" : "RP pod"} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) {
      const d = l.startsWith("data:") ? l.slice(5).trim() : "";
      if (!d || d === "[DONE]") continue;
      const j = JSON.parse(d);
      if (j.error) throw new Error(j.error.message ?? String(j.error));
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    }
  }
}

export async function* chatStream(system: string, messages: ChatMsg[] | { role: string; content: string }[], opts: StreamOpts = {}): AsyncGenerator<string> {
  if (isPod(opts.model) || isKobold(opts.model)) {
    if (isKobold(opts.model)) await ensureKobold();
    yield* podStream(opts.system === false ? messages : [{ role: "system", content: system }, ...messages], opts);
    return;
  }
  if (!opts.model && !(await heavyGate.ensureLight())) throw paused("The co-pilot");
  const r = await post(`${OLLAMA_URL}/api/chat`, chatBody(system, messages, opts), 600_000);
  if (!r.ok || !r.body) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) {
      if (!l.trim()) continue;
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      if (j.message?.content) yield j.message.content;
    }
  }
}

/** Embeddings via Ollama /api/embed (one vector per text). */
export async function embed(model: string, texts: string[]): Promise<number[][]> {
  const r = await post(`${OLLAMA_URL}/api/embed`, { model, input: texts, keep_alive: "30m" }, 120_000);
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  return (await r.json()).embeddings as number[][];
}

export async function tipoComplete(prompt: string): Promise<string> {
  if (!(await heavyGate.ensureLight())) throw paused("TIPO");
  const r = await post(`${TIPO_URL}/completion`, { prompt, n_predict: 256, temperature: 1.0, min_p: 0.1 }, 60_000);
  if (!r.ok) throw new Error(`TIPO ${r.status}`);
  return (await r.json()).content as string;
}

/** ToriiGate single-turn caption; `query` is built from its prompts.py templates. */
export async function caption(imageUrl: string, query: string): Promise<string> {
  if (!(await heavyGate.ensureLight())) throw paused("The captioner");
  const r = await post(`${CAPTION_URL}/v1/chat/completions`, {
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: query }] }],
    temperature: 0.5, max_tokens: 1024,
  }, 180_000);
  if (!r.ok) throw new Error(`Captioner ${r.status}`);
  return (await r.json()).choices[0].message.content as string;
}

/** ToriiGate "long" format grounded on booru tags (prompts.py make_user_query, use_names=False). */
export function toriiQuery(tags: string): string {
  return `# Captioning format:\nMake a caption for given image with natural text. Use 2 to 5 paragraphs. Make your description long and vivid, mentioning all the details.\n\n${tags ? `# Booru tags for the image\n[${tags}]\n\n` : ""}# Characters on picture:\nAvoid to guess names for characters.\n`;
}

/**
 * ToriiGate steered by the user's focus question (e.g. "how exactly is the armor broken?"): a long, detailed caption
 * that concentrates on that detail. Without a focus it is the normal long caption.
 */
export function focusQuery(tags: string, focus: string): string {
  if (!focus.trim()) return toriiQuery(tags);
  return `# Captioning format:\nMake a long, precise description of the image that concentrates on the focus below. Describe that part in close detail (exact garments and their state, damage, exposure, materials, pose, objects); mention the rest briefly.\n\n# Focus:\n${focus.trim().slice(0, 300)}\n\n${tags ? `# Booru tags for the image\n[${tags}]\n\n` : ""}# Characters on picture:\nAvoid to guess names for characters.\n`;
}
