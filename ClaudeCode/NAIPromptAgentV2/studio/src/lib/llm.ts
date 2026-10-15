import { spawn } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { BRAIN_MODEL, CAPTION_URL, OLLAMA_URL, TIPO_URL } from "./env";
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

/** One shared pause for heavy-model calls (see HeavyGate). */
export const heavyGate = new HeavyGate({ power });
const paused = (what: string) => new Error(`${what} is paused while the heavy model is replying — try again in a moment`);

export type StreamOpts = { model?: string; options?: Record<string, unknown>; stop?: string[]; system?: boolean };

/**
 * Streams reply text chunks; thinking tokens are skipped. Without `opts.model` it's the everyday brain (servers
 * restored first if the heavy gate paused them); heavy callers wrap this in `heavyGate.run`.
 * `system: false` sends `messages` as-is (RP assembles its own system turns).
 */
/** Ollama /api/chat body. Heavy calls (explicit model) turn thinking off: APEX would otherwise think away the whole reply budget. */
export function chatBody(system: string, messages: ChatMsg[] | { role: string; content: string }[], opts: StreamOpts = {}): Record<string, unknown> {
  return {
    model: opts.model ?? BRAIN_MODEL, stream: true, keep_alive: opts.model ? "30m" : "2h",
    ...(opts.model ? { think: false } : {}),
    messages: opts.system === false ? messages : [{ role: "system", content: system }, ...messages],
    options: { temperature: 0.6, top_k: 64, top_p: 0.9, min_p: 0.05, repeat_penalty: 1.1, num_ctx: 16384, ...opts.options, ...(opts.stop?.length ? { stop: opts.stop } : {}) },
  };
}

export async function* chatStream(system: string, messages: ChatMsg[] | { role: string; content: string }[], opts: StreamOpts = {}): AsyncGenerator<string> {
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
