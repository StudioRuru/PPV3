// Retrieved few-shot voice, ported from Delfino Plaza src/lib/voice.ts: each turn, the character lines closest to
// what the user just said (brute-force cosine; pools are tens to low thousands of lines).
import type { RpStore } from "./store";

export const VOICE_TOP_K = 4;
export type Embed = (model: string, texts: string[]) => Promise<number[][]>;
type Line = { text: string; context: string; embedding: Buffer | null; embedModel: string };

export function toVector(buf: Buffer | null): Float32Array | null {
  if (!buf || buf.byteLength < 4 || buf.byteLength % 4 !== 0) return null;
  const copy = new Uint8Array(buf.byteLength); // Buffer pools aren't 4-byte aligned; Float32Array needs alignment
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

export function toBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? -1 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Top-k lines by cosine to `query`; lines without a vector for `model` are skipped. */
export function rankVoiceLines<L extends Line>(query: number[], lines: L[], model: string, k = VOICE_TOP_K): (L & { score: number })[] {
  return lines
    .filter((l) => l.embedModel === model)
    .map((l) => ({ ...l, score: cosine(query, toVector(l.embedding) ?? []) }))
    .filter((l) => l.score > -1)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}

/** The situation is embedded with the words, so "after a win" lines surface when the talk is about winning. */
const embedText = (l: { text: string; context: string }) => (l.context ? `(${l.context}) ${l.text}` : l.text);

/** Give every line a vector for the current model (missing or other-model vectors are recomputed). */
export async function embedVoiceLines(store: RpStore, characterId: number, model: string, embed: Embed): Promise<{ embedded: number; total: number }> {
  const lines = store.voiceLines(characterId);
  const stale = model ? lines.filter((l) => !l.embedding || l.embedModel !== model) : [];
  if (!stale.length) return { embedded: 0, total: lines.length };
  const vectors = await embed(model, stale.map(embedText));
  stale.forEach((l, i) => { if (vectors[i]?.length) store.setEmbedding(l.id, toBuffer(new Float32Array(vectors[i])), model); });
  return { embedded: stale.length, total: lines.length };
}

/** Lines for this turn. Never throws: losing voice examples should soften the voice, not fail the turn. */
export async function selectVoiceLines(store: RpStore, characterId: number, query: string, model: string, embed: Embed, k = VOICE_TOP_K) {
  if (!model || !query.trim()) return [];
  const lines = store.voiceLines(characterId).filter((l) => l.embedding && l.embedModel === model);
  if (!lines.length) return [];
  try {
    const [q] = await embed(model, [query.trim()]);
    return q?.length ? rankVoiceLines(q, lines, model, k).map(({ text, context, score }) => ({ text, context, score })) : [];
  } catch {
    return [];
  }
}
