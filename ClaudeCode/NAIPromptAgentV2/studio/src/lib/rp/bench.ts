// RP eval bench scoring: cheap, deterministic signals per reply. The runner is scripts/rp-bench.mts.

/** Stock "AI prose" phrases. Hits per 1k words is the slop rate. */
export const SLOP = [
  "shivers down", "shiver down", "sent a shiver", "barely above a whisper", "a mix of", "mixture of", "ministrations",
  "testament to", "tapestry", "can't help but", "couldn't help but", "maybe, just maybe", "eyes sparkling with mischief",
  "a wicked glint", "padded over", "padded across", "a glint in", "voice dripping with", "smirk playing", "playful smirk", "breath hitch",
  "breath hitched", "pupils dilated", "wanton", "ruin you", "you're mine", "little did",
  "the air grew thick", "the air thick with", "palpable", "despite herself", "despite himself",
  "a dance of", "in the grand scheme", "is that what you want",
];

/** Words allowed per reply-length level (prose); texts allowed per level (texting), ±1 tolerated. */
export const WORDS_FOR_LEVEL: [number, number][] = [[1, 45], [12, 75], [30, 120], [80, 280], [180, 800]];
export const TEXTS_FOR_LEVEL: [number, number][] = [[1, 1], [1, 2], [2, 3], [3, 5], [4, 7]];

export const words = (t: string) => t.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const grams = (t: string, n = 3) => { const w = words(t); return new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" "))); };
/** Text with quoted speech removed, so narration checks don't fire on dialogue. */
const narration = (t: string) => t.replace(/["“][^"”]*["”]/g, " ");
export const texts = (t: string) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

export type ReplyScore = {
  words: number; lengthOk: boolean; echo: number; openingRepeat: boolean; slop: string[];
  agency: number; styleBreak: boolean; memory?: boolean;
};

/**
 * Scores one reply against the replies before it in the same run.
 * echo = share of this reply's word trigrams already used in an earlier reply (0 fresh … 1 copy).
 * agency = narration lines where {{user}} acts ("Kai smiles", "you feel") — the model deciding for the player.
 */
export function scoreReply(reply: string, prior: string[], o: { style: string; length: number; user: string; expect?: string }): ReplyScore {
  const w = words(reply);
  const text = o.style === "text";
  const [lo, hi] = text ? TEXTS_FOR_LEVEL[o.length] : WORDS_FOR_LEVEL[o.length];
  const n = text ? texts(reply).length : w.length;
  const tol = text ? 1 : 0;
  const g = grams(reply);
  const seen = new Set(prior.flatMap((p) => [...grams(p)]));
  const echo = g.size ? [...g].filter((x) => seen.has(x)).length / g.size : 0;
  const open = (t: string) => words(t).slice(0, 3).join(" ");
  const lower = reply.toLowerCase();
  const nar = narration(reply);
  const u = o.user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const agency = (nar.match(new RegExp(`\\b${u}\\s+(?!is\\b|was\\b|has\\b|had\\b)[a-z]+(?:s|ed)\\b`, "g")) ?? []).length
    + (nar.match(/\byou (?:feel|decide|realize|realise|find yourself|can't help|moan|gasp|shiver|nod|agree)\b/gi) ?? []).length;
  const styleBreak = text ? /^\s*[*"“]/m.test(reply) : o.style === "rp" ? /\bI(?:'m|'ve|'d|'ll)?\b/.test(nar) : false;
  return {
    words: w.length, lengthOk: n >= lo - tol && n <= hi + tol, echo: Math.round(echo * 1000) / 1000,
    openingRepeat: prior.slice(-3).some((p) => open(p) && open(p) === open(reply)),
    slop: SLOP.filter((s) => lower.includes(s)), agency, styleBreak,
    ...(o.expect ? { memory: new RegExp(o.expect, "i").test(reply) } : {}),
  };
}

export type Summary = {
  replies: number; lengthOk: number; echo: number; openingRepeats: number; slopPer1k: number;
  agency: number; styleBreaks: number; memory: number | null; judge: number | null;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Roll scores (and optional judge totals) into one comparable row. Lower is better except lengthOk, memory, judge. */
export function summarize(scores: ReplyScore[], judge: number[] = []): Summary {
  const mem = scores.filter((s) => s.memory !== undefined);
  const totalWords = scores.reduce((a, s) => a + s.words, 0);
  return {
    replies: scores.length,
    lengthOk: r2(avg(scores.map((s) => +s.lengthOk))),
    echo: r2(avg(scores.map((s) => s.echo))),
    openingRepeats: scores.filter((s) => s.openingRepeat).length,
    slopPer1k: r2(totalWords ? (scores.reduce((a, s) => a + s.slop.length, 0) * 1000) / totalWords : 0),
    agency: scores.reduce((a, s) => a + s.agency, 0),
    styleBreaks: scores.filter((s) => s.styleBreak).length,
    memory: mem.length ? r2(avg(mem.map((s) => +s.memory!))) : null,
    judge: judge.length ? r2(avg(judge)) : null,
  };
}
