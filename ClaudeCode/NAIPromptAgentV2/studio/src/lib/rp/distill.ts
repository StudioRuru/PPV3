// Ported from Delfino Plaza src/lib/ingest/distill.ts.
import type { Settings, ChatMessage } from "./llm-shim";
import type { StagedEntry, StagedVoiceLine } from "./studio-types";
import { defaultModelFor, getProvider } from "./llm-shim";

export type { StagedEntry, StagedVoiceLine } from "./studio-types";

/**
 * Turning a canon source into lorebook entries and voice lines.
 *
 * The naive version of this feature — paste the wiki page into the prompt — is
 * actively harmful at an 8k context: it buries the character sheet under trivia
 * that is mostly irrelevant to any given turn. So the page is *distilled* into
 * small keyed entries that only enter the prompt when the conversation touches
 * them, plus a pool of quotable lines for voice retrieval.
 *
 * The distiller is the product here; the URL is just input.
 */

/** Cap on output per chunk, so one runaway chunk can't stall the whole ingest. */
const NUM_PREDICT = 900;
/** Chunks to distil at once. Local models are the bottleneck; keep it serial-ish. */
export const MAX_CHUNKS = 24;

export interface DistilledChunk {
  entries: StagedEntry[];
  voiceLines: StagedVoiceLine[];
}

function systemPrompt(subject: string, mode: "lore" | "voice" | "both"): string {
  const want =
    mode === "lore"
      ? "Extract lorebook entries only. Return an empty voiceLines array."
      : mode === "voice"
        ? "Extract quotable lines only. Return an empty entries array."
        : "Extract both lorebook entries and quotable lines.";

  return [
    `You extract structured canon from reference material about ${subject} for a roleplay character card.`,
    want,
    "",
    "A LOREBOOK ENTRY is a fact that should reach the model only when the conversation touches it.",
    "Rules for entries, all mandatory:",
    "- `content` MUST stand alone. The keys and the name are NEVER shown to the model — only `content` is. So never write 'She is fast'; write '<Name> is fast'.",
    "- `content` MUST be at most 60 words. Terse, factual, present tense.",
    "- `keys` are the words a user would actually type to summon this entry. Include every alias the SOURCE gives: English name, Japanese name (kana/kanji), nicknames, shorthand.",
    "- NEVER invent a key. Copy each key character-for-character from the source. If the source does not state a Japanese name, do not write one — a guessed alias is worse than none.",
    "- Do not use a bare infobox label ('height', 'weight', 'birthday') as a key; those fire on unrelated conversation.",
    "- At most ONE entry in the whole document may set `constant: true`: the core identity of the subject. An appearance, an outfit, a stat line or a discography is NEVER constant.",
    "- `position` is 'before' for background/setting, 'after' for facts that should land close to the reply.",
    "- Extract ONLY what the source states. Never infer, guess, or embellish. If a chunk has no real canon, return an empty array.",
    "",
    "A QUOTABLE LINE is something the character actually SAYS, in their own voice: catchphrases, greetings, verbal tics, memorable quotes.",
    "Rules for lines:",
    "- `text` is the character's own words. Keep the original wording, including the original language and any tic or stutter. Do not paraphrase or translate.",
    "- `context` is the situation in a few words ('greeting', 'after a win', 'flustered').",
    "- Do NOT invent lines. If the source quotes nothing, return an empty array.",
    "",
    "Output ONLY a JSON object, no prose, no markdown fence:",
    '{"entries":[{"name":"","keys":[""],"content":"","position":"after","constant":false}],"voiceLines":[{"text":"","context":""}]}',
  ].join("\n");
}

/** Pull the first JSON object out of a model reply that may still be wrapped in prose or a fence. */
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
}

/**
 * Infobox field labels the model tends to mistake for keys. A lorebook keyed on
 * "height" fires whenever anyone mentions height, which is never what was meant.
 */
const GENERIC_KEYS = new Set([
  "height", "weight", "age", "name", "gender", "species", "birthday", "born",
  "stats", "threesizes", "three sizes", "bust", "waist", "hips", "status",
  "japanese", "english", "kana", "romaji", "romanji", "nickname", "aliases",
]);

/**
 * Keep only keys that literally occur in the source.
 *
 * This is the anti-confabulation guard that matters. Asked for a character's
 * Japanese aliases, a mid-size local model will cheerfully *invent* plausible kana
 * — for Sweep Tosho it produced スイープときは, which is not her name. A key like
 * that is silent poison: it never matches, so the entry it guards simply never
 * fires and nobody ever learns why. Grounding every key in the source text makes
 * that class of error impossible, at the cost of rejecting the rare genuine alias
 * the model knew and the page didn't state.
 */
function groundKeys(keys: string[], source: string): string[] {
  const haystack = source.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const key = k.trim();
    const lower = key.toLowerCase();
    if (key.length < 2 || seen.has(lower)) continue;
    if (GENERIC_KEYS.has(lower)) continue;
    if (!haystack.includes(lower)) continue; // Not in the source → the model made it up.
    seen.add(lower);
    out.push(key);
  }
  return out;
}

/** Coerce a model's loosely-shaped JSON into staged records, dropping anything unusable. */
function coerce(parsed: unknown, source: string): DistilledChunk {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const rawEntries = Array.isArray(o.entries) ? o.entries : [];
  const rawLines = Array.isArray(o.voiceLines) ? o.voiceLines : [];

  const entries: StagedEntry[] = [];
  for (const r of rawEntries) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const content = typeof e.content === "string" ? e.content.trim() : "";
    const keys = groundKeys(asStringArray(e.keys), source);
    // An entry with no content is worthless; one with no surviving keys can never
    // fire unless it's constant, so it would be silently dead weight.
    if (!content) continue;
    if (!keys.length && e.constant !== true) continue;
    entries.push({
      name: (typeof e.name === "string" && e.name.trim()) || keys[0] || "Untitled",
      keys,
      content,
      position: e.position === "before" ? "before" : "after",
      constant: e.constant === true,
    });
  }

  const voiceLines: StagedVoiceLine[] = [];
  for (const r of rawLines) {
    if (!r || typeof r !== "object") continue;
    const l = r as Record<string, unknown>;
    const text = typeof l.text === "string" ? l.text.trim() : "";
    if (!text) continue;
    voiceLines.push({
      text,
      context: typeof l.context === "string" ? l.context.trim() : "",
    });
  }

  return { entries, voiceLines };
}

/**
 * Distil one chunk. Returns empty on any failure — a chunk the model fumbles
 * should cost that chunk's facts, not the whole ingest.
 */
export async function distillChunk(
  chunk: string,
  subject: string,
  mode: "lore" | "voice" | "both",
  settings: Settings,
): Promise<DistilledChunk> {
  const model = defaultModelFor(settings);
  if (!model) return { entries: [], voiceLines: [] };

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(subject, mode) },
    { role: "user", content: `Source material:\n\n${chunk}\n\nExtract the JSON now.` },
  ];

  try {
    const provider = getProvider(settings);
    let out = "";
    for await (const delta of provider.streamChat({
      model,
      messages,
      options: {
        temperature: 0.2, // Extraction, not invention.
        num_ctx: settings.numCtx,
        num_predict: NUM_PREDICT,
      },
    })) {
      out += delta;
    }
    // Keys are grounded against the chunk they came from, so an invented alias is
    // discarded rather than becoming an entry that can never fire.
    return coerce(extractJson(out), chunk);
  } catch {
    return { entries: [], voiceLines: [] };
  }
}

/**
 * How many entries may be `constant` (injected on every single turn).
 *
 * The model marks far too many: given a wiki page it will happily declare the
 * character's outfit, stats and discography all permanently essential, and each
 * one is then a permanent tax on a context window that is only 8k to begin with.
 * One constant entry — core identity — is almost always the right number; the rest
 * keep their keys and fire when relevant.
 */
const MAX_CONSTANT = 1;

/** Merge chunk results, dropping entries and lines that duplicate one already kept. */
export function mergeDistilled(parts: DistilledChunk[]): DistilledChunk {
  const entries: StagedEntry[] = [];
  const voiceLines: StagedVoiceLine[] = [];
  const seenEntry = new Set<string>();
  const seenLine = new Set<string>();

  for (const p of parts) {
    for (const e of p.entries) {
      const fingerprint = e.content.toLowerCase().replace(/\s+/g, " ");
      if (seenEntry.has(fingerprint)) continue;
      seenEntry.add(fingerprint);
      entries.push(e);
    }
    for (const l of p.voiceLines) {
      const fingerprint = l.text.toLowerCase().replace(/\s+/g, " ");
      if (seenLine.has(fingerprint)) continue;
      seenLine.add(fingerprint);
      voiceLines.push(l);
    }
  }

  // Demote surplus constants — the longest-keyed one is kept, being the entry that
  // enumerated the most aliases and so most likely the core identity entry. A
  // demoted entry keeps its keys, so it still fires when it's actually relevant.
  const constants = entries
    .filter((e) => e.constant)
    .sort((a, b) => b.keys.length - a.keys.length);
  for (const e of constants.slice(MAX_CONSTANT)) {
    e.constant = false;
    // A demoted entry with no keys could never fire again, so drop it below.
  }
  const kept = entries.filter((e) => e.constant || e.keys.length > 0);

  // Names are only for the review UI, but four rows all called "Sweep Tosho" makes
  // it impossible to tell what you're approving.
  const nameCount = new Map<string, number>();
  for (const e of kept) {
    const n = nameCount.get(e.name) ?? 0;
    nameCount.set(e.name, n + 1);
    if (n > 0) e.name = `${e.name} (${n + 1})`;
  }

  return { entries: kept, voiceLines };
}
