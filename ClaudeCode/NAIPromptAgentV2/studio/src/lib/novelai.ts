import "server-only";
import { unzipSync } from "fflate";
import { buildNaiBody, type NaiParams } from "./nai-body";
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

export async function generateImage(c: Compiled, p: NaiParams, token: string) {
  if (!token) throw new NovelAIError("NOVELAI_TOKEN is not set on the server.", 500);
  const { body, seed } = buildNaiBody(c, p);
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
