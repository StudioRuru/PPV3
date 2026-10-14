import "server-only";
import { unzipSync } from "fflate";
import { buildNaiBody, costOf, type Img2Img, type NaiParams } from "./nai-body";
import { isPreSendError } from "./net";
import type { Compiled } from "./prompt";

const ENDPOINT = "https://image.novelai.net/ai/generate-image";
// Cloudflare 403s (error 1010) without a browser-like UA. Verified in Delfino 2026-06-05.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class NovelAIError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const STATUS: Record<number, string> = {
  401: "NovelAI token invalid or expired.",
  402: "Out of Anlas / subscription required for these settings.",
  429: "NovelAI rate limit — wait a moment and try again.",
  500: "NovelAI rejected the request (often a malformed v4 prompt field).",
};

/** Retry only errors raised before the request was sent (no double charge). */
async function post(init: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(ENDPOINT, init);
    } catch (err) {
      if (!isPreSendError(err) || i === attempts - 1) throw new NovelAIError(`Could not reach NovelAI: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

export async function generateImage(c: Compiled, p: NaiParams, token: string, img2img?: Img2Img) {
  if (!token) throw new NovelAIError("NOVELAI_TOKEN is not set on the server.", 500);
  const { body, seed } = buildNaiBody(c, p, img2img);
  const res = await post({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "*/*" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new NovelAIError(STATUS[res.status] ?? `NovelAI error ${res.status}: ${detail.slice(0, 200)}`, res.status);
  }
  const files = Object.values(unzipSync(new Uint8Array(await res.arrayBuffer())));
  const png = files.find((f) => f.length);
  if (!png) throw new NovelAIError("NovelAI returned no image.");
  return { png: Buffer.from(png), seed };
}

// api.novelai.net now answers "update to the image URL" (2026-10): account + upscale live on the image host.
const API = "https://image.novelai.net";
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "*/*" });

/** Current Anlas (monthly + purchased). Read-only; used to show cost before and spend after. */
export async function anlas(token: string, timeoutMs = 10_000): Promise<number> {
  if (!token) throw new NovelAIError("NOVELAI_TOKEN is not set on the server.", 500);
  const res = await fetch(`${API}/user/subscription`, { headers: auth(token), signal: AbortSignal.timeout(timeoutMs) })
    .catch((e) => { throw new NovelAIError(`Could not reach NovelAI: ${(e as Error).message}`); });
  if (!res.ok) throw new NovelAIError(STATUS[res.status] ?? `NovelAI error ${res.status}`, res.status);
  const t = (await res.json())?.trainingStepsLeft ?? {};
  return (t.fixedTrainingStepsLeft ?? 0) + (t.purchasedTrainingSteps ?? 0);
}

/** NovelAI 4× upscale. Spends Anlas — callers confirm with the user first. Reply is a zip (older: raw PNG). */
export async function upscaleImage(png: Buffer, width: number, height: number, model: string, token: string): Promise<Buffer> {
  if (!token) throw new NovelAIError("NOVELAI_TOKEN is not set on the server.", 500);
  const res = await fetch(`${API}/ai/upscale`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ image: png.toString("base64"), width, height, scale: 4, model }),
    signal: AbortSignal.timeout(180_000),
  }).catch((e) => { throw new NovelAIError(`Upscale didn't finish (${(e as Error).message}). It may already have been charged — check the balance before trying again.`); });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new NovelAIError(res.status === 401 || res.status === 402 ? STATUS[res.status] : `Upscale failed (${res.status}): ${detail.slice(0, 200)}`, res.status);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const out = isZip ? Object.values(unzipSync(buf)).find((f) => f.length) : buf;
  if (!out?.length) throw new NovelAIError("NovelAI returned no upscaled image.");
  return Buffer.from(out);
}

let inFlight = 0;
let started = 0;
/**
 * Run a spend and measure what it cost from the balance before/after. Short timeouts so a slow account
 * endpoint can't hold up images; unknown (null) when another spend overlapped, since the diff would mix them.
 */
export async function measured<T>(token: string, run: () => Promise<T>): Promise<{ result: T; cost: number | null }> {
  const ticket = ++started;
  inFlight++;
  try {
    const overlappedAtStart = inFlight > 1;
    const before = await anlas(token, 3000).catch(() => null);
    const result = await run();
    const after = await anlas(token, 3000).catch(() => null);
    return { result, cost: costOf(before, after, overlappedAtStart || started !== ticket) };
  } finally {
    inFlight--;
  }
}
