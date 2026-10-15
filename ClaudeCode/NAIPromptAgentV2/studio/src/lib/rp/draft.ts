// Ported from Delfino Plaza src/lib/studio/draft.ts.
import type { Settings, ChatMessage } from "./llm-shim";
import { defaultModelFor, getProvider } from "./llm-shim";
import { DIALOGUE_STYLES, POV_MODES, TENSES } from "./presets";
import type { ResearchModifiers, StagedEntry, StagedVoiceLine, StateSeed, StudioCard } from "./studio-types";
import { chunkText, fetchPageText, IngestError } from "./ingest";
import { distillChunk, mergeDistilled, MAX_CHUNKS, type DistilledChunk } from "./distill";

/**
 * The Character Studio's agent draft.
 *
 * Given a short concept ("a jaded space-station bartender who used to be a war
 * medic"), one LLM call fleshes it out into a full character card the user then
 * refines in the wizard. Unlike the canon distiller (src/lib/ingest/distill.ts)
 * this step *wants* invention — there is no source to ground against — so it runs
 * warmer and skips the grounding guards. It shares that module's contract though:
 * a schema-literal system prompt, prompt-for-JSON, and a defensive coercer, since
 * there is no JSON mode in either provider adapter.
 */

/** Cap on output for one draft. A full card is comfortably under this. */
const NUM_PREDICT = 1400;

/** An empty card, used as the coercion base so every field is always present. */
export function emptyCard(): StudioCard {
  return {
    name: "",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    exampleDialogue: "",
    alternateGreetings: [],
    tags: [],
    povMode: "",
    tense: "",
    dialogueStyle: "",
    voiceLines: [],
  };
}

function systemPrompt(): string {
  return [
    "You are a character-card author for an immersive roleplay app. From the user's concept you write a single, vivid, playable character.",
    "",
    "Field rules, all mandatory:",
    "- `name`: a fitting name for the character.",
    "- `description`: who they are — appearance, background, situation. Concrete facts, a few sentences.",
    "- `personality`: their voice and temperament as terse bullet-like phrases. FRONT-LOAD the most distinctive speech traits; the opening is what anchors the model's voice.",
    "- `scenario`: the setting the roleplay opens in, one or two sentences.",
    "- `firstMessage`: how the character opens the scene, in their own voice. You may use {{user}} for the player and {{char}} for the character.",
    "- `exampleDialogue`: 2–4 short exchanges showing their distinct voice, as lines labelled `{{char}}:` and `{{user}}:`.",
    "- `alternateGreetings`: 0–2 alternative opening messages, same rules as firstMessage. May be empty.",
    "- `tags`: a few short genre/trait tags.",
    "- `voiceLines`: 3–6 short lines the character actually SAYS — catchphrases, greetings, verbal tics — each with a brief `context` ('greeting', 'annoyed'). These teach voice.",
    "",
    "Structural suggestions — pick the values that suit the character, or \"\" to leave unlocked:",
    `- \`povMode\`: one of ${POV_MODES.filter(Boolean).map((v) => `"${v}"`).join(", ")} or "".`,
    `- \`tense\`: one of ${TENSES.filter(Boolean).map((v) => `"${v}"`).join(", ")} or "".`,
    `- \`dialogueStyle\`: one of ${DIALOGUE_STYLES.filter(Boolean).map((v) => `"${v}"`).join(", ")} or "". "quotes-asterisks" (spoken words in quotes, actions in *asterisks*) is a good default for roleplay.`,
    "",
    "Output ONLY a JSON object, no prose, no markdown fence:",
    '{"name":"","description":"","personality":"","scenario":"","firstMessage":"","exampleDialogue":"","alternateGreetings":[""],"tags":[""],"povMode":"","tense":"","dialogueStyle":"","voiceLines":[{"text":"","context":""}]}',
  ].join("\n");
}

/** Pull the first JSON object out of a reply that may still be wrapped in prose or a fence. */
export function extractJson(raw: string): unknown {
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

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
}

/** Constrain a structural value to the allowed set; anything else becomes "" (no lock). */
function oneOf(v: unknown, allowed: readonly string[]): string {
  const s = asString(v);
  return allowed.includes(s) ? s : "";
}

/** Coerce a model's loosely-shaped JSON into a StudioCard, dropping anything unusable. */
export function coerceCard(parsed: unknown): StudioCard {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const card = emptyCard();
  card.name = asString(o.name);
  card.description = asString(o.description);
  card.personality = asString(o.personality);
  card.scenario = asString(o.scenario);
  card.firstMessage = asString(o.firstMessage);
  card.exampleDialogue = asString(o.exampleDialogue);
  card.alternateGreetings = asStringArray(o.alternateGreetings);
  card.tags = asStringArray(o.tags);
  card.povMode = oneOf(o.povMode, POV_MODES);
  card.tense = oneOf(o.tense, TENSES);
  card.dialogueStyle = oneOf(o.dialogueStyle, DIALOGUE_STYLES);

  const rawLines = Array.isArray(o.voiceLines) ? o.voiceLines : [];
  for (const r of rawLines) {
    if (!r || typeof r !== "object") continue;
    const l = r as Record<string, unknown>;
    const text = asString(l.text);
    if (!text) continue;
    card.voiceLines.push({ text, context: asString(l.context) });
  }
  return card;
}

/**
 * Draft a full card from a free-text concept. Returns an empty card on any
 * failure — a fumbled draft should leave the wizard empty, not throw.
 */
export async function draftCard(concept: string, settings: Settings): Promise<StudioCard> {
  const model = defaultModelFor(settings);
  if (!model) return emptyCard();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: `Concept:\n\n${concept}\n\nWrite the character card JSON now.` },
  ];

  try {
    const provider = getProvider(settings);
    let out = "";
    for await (const delta of provider.streamChat({
      model,
      messages,
      options: {
        temperature: 0.7, // Invention, not extraction.
        num_ctx: settings.numCtx,
        num_predict: NUM_PREDICT,
      },
    })) {
      out += delta;
    }
    return coerceCard(extractJson(out));
  } catch {
    return emptyCard();
  }
}

/* --------------------------- known-character research -------------------- */

/**
 * Known-character research shares the canon distiller wholesale: the fetched wiki
 * page(s) are chunked and run through `distillChunk` (which already grounds every
 * lorebook key against its source, discarding invented aliases), then a single
 * grounded synthesis call turns the same source into the card's prose fields. The
 * distiller supplies the canon lorebook + quotable lines; synthesis supplies the
 * personality/description/greeting the wiki never states outright but the text
 * supports.
 */

/** Cap on the excerpt kept for (cheap) re-synthesis when modifiers change. */
const EXCERPT_CHARS = 6000;
/** Pages to read per research run — a character's main article is usually enough. */
const MAX_PAGES = 3;

export interface ResearchProgress {
  phase: "fetching" | "distilling" | "writing";
  message: string;
  total?: number;
  done?: number;
  entries?: number;
  voiceLines?: number;
}

export interface ResearchSourceResult {
  entries: StagedEntry[];
  voiceLines: StagedVoiceLine[];
  /** Concatenated page text, capped — kept so modifier tweaks can re-synthesise cheaply. */
  sourceExcerpt: string;
  title: string;
}

/** Fetch and distil the chosen pages into canon entries + voice lines + an excerpt. */
export async function researchSource(
  subject: string,
  pageUrls: string[],
  settings: Settings,
  onProgress: (p: ResearchProgress) => void,
  signal?: AbortSignal,
): Promise<ResearchSourceResult> {
  const pages = pageUrls.slice(0, MAX_PAGES);
  let allText = "";
  let title = "";
  for (const url of pages) {
    if (signal?.aborted) break;
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep the raw string for the message */
    }
    onProgress({ phase: "fetching", message: `Fetching ${host}…` });
    try {
      const page = await fetchPageText(url);
      if (!title) title = page.title;
      allText += (allText ? "\n\n" : "") + page.text;
    } catch {
      // A page that fails costs that page, not the whole run.
    }
  }
  if (!allText.trim()) {
    throw new IngestError("Couldn't read any of the selected pages. Try a different one.");
  }

  const chunks = chunkText(allText).slice(0, MAX_CHUNKS);
  onProgress({
    phase: "distilling",
    message: `Reading “${title || subject}” — ${chunks.length} section${chunks.length === 1 ? "" : "s"}…`,
    total: chunks.length,
    done: 0,
  });

  const parts: DistilledChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) break;
    parts.push(await distillChunk(chunks[i], subject, "both", settings));
    const soFar = mergeDistilled(parts);
    onProgress({
      phase: "distilling",
      message: `Distilled ${i + 1} of ${chunks.length}…`,
      total: chunks.length,
      done: i + 1,
      entries: soFar.entries.length,
      voiceLines: soFar.voiceLines.length,
    });
  }

  const merged = mergeDistilled(parts);
  return {
    entries: merged.entries,
    voiceLines: merged.voiceLines,
    sourceExcerpt: allText.slice(0, EXCERPT_CHARS),
    title,
  };
}

const FAITHFULNESS: Record<ResearchModifiers["faithfulness"], string> = {
  canon: "Stay strictly faithful to canon: do not add traits, relationships, or events the source doesn't state.",
  balanced: "Stay close to canon, but you may smooth over gaps for playability where the source is silent.",
  reinterpret: "Treat the source as a springboard — a fresh, playable take on the character is welcome, as long as it stays recognisable.",
};
const TONE: Record<ResearchModifiers["tone"], string> = {
  "": "",
  wholesome: "Lean the portrayal warm, kind, and wholesome.",
  flirty: "Lean the portrayal playful and flirtatious.",
  dark: "Lean the portrayal darker, moodier, more intense.",
  comedic: "Lean the portrayal light, witty, and comedic.",
};
const RELATIONSHIP: Record<ResearchModifiers["relationship"], string> = {
  "": "",
  stranger: "Frame the opening so the character has only just met {{user}} — a stranger.",
  friend: "Frame the opening so the character already knows {{user}} as a friend.",
  partner: "Frame the opening so the character is {{user}}'s close romantic partner.",
  rival: "Frame the opening so the character regards {{user}} as a rival.",
};

function modifierDirective(m: ResearchModifiers): string {
  return [FAITHFULNESS[m.faithfulness], TONE[m.tone], RELATIONSHIP[m.relationship]]
    .filter(Boolean)
    .join(" ");
}

function synthesisSystemPrompt(name: string, modifiers: ResearchModifiers): string {
  return [
    `You write a roleplay character card for ${name}, grounded ONLY in the provided reference material.`,
    "Do NOT invent facts, relationships, powers, or events the source does not support. If the source is thin on something, keep that field brief rather than fabricating.",
    modifierDirective(modifiers),
    "",
    "Fill these fields:",
    "- `description`: who they are — appearance, background, situation — drawn from the source.",
    "- `personality`: their voice and temperament as terse bullet-like phrases; FRONT-LOAD the most distinctive speech traits.",
    "- `scenario`: a fitting opening setting consistent with the source.",
    "- `firstMessage`: an in-character opening line; you may use {{user}} and {{char}}.",
    "- `exampleDialogue`: 2–4 short `{{char}}:` / `{{user}}:` exchanges in their voice.",
    "- `tags`: a few short genre/trait tags.",
    "- `povMode`/`tense`/`dialogueStyle`: structural suggestions, or \"\" to leave unlocked. \"quotes-asterisks\" suits most roleplay.",
    "- `alternateGreetings`: [] (leave empty).",
    "- `voiceLines`: [] (leave empty — canon lines are gathered separately).",
    "",
    "Output ONLY a JSON object, no prose, no markdown fence:",
    '{"name":"","description":"","personality":"","scenario":"","firstMessage":"","exampleDialogue":"","alternateGreetings":[],"tags":[""],"povMode":"","tense":"","dialogueStyle":"","voiceLines":[]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Synthesise the card's prose fields from researched source + distilled canon,
 * biased by the modifiers. Grounded (low temperature, "source only" instruction);
 * the name is forced to what the user searched for. Returns an empty card on
 * failure so the caller can surface a clean retry.
 */
export async function synthesizeCard(
  name: string,
  sourceExcerpt: string,
  entries: StagedEntry[],
  modifiers: ResearchModifiers,
  settings: Settings,
): Promise<StudioCard> {
  const model = defaultModelFor(settings);
  if (!model) return { ...emptyCard(), name };

  const canon = entries
    .slice(0, 12)
    .map((e) => `- ${e.content}`)
    .join("\n");
  const userContent = [
    `Reference material about ${name}:`,
    "",
    sourceExcerpt,
    canon ? `\n[Distilled canon facts]\n${canon}` : "",
    "",
    "Write the character card JSON now.",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: synthesisSystemPrompt(name, modifiers) },
    { role: "user", content: userContent },
  ];

  try {
    const provider = getProvider(settings);
    let out = "";
    for await (const delta of provider.streamChat({
      model,
      messages,
      options: {
        temperature: 0.4, // Grounded synthesis: some flair, little invention.
        num_ctx: settings.numCtx,
        num_predict: NUM_PREDICT,
      },
    })) {
      out += delta;
    }
    const card = coerceCard(extractJson(out));
    card.name = name; // We know the subject; never let the model rename it.
    return card;
  } catch {
    return { ...emptyCard(), name };
  }
}

/* ----------------------- conversation essence analyzer ------------------- */

/**
 * Capture an individual's "essence" from sample conversation text and turn it
 * into a card. Where research grounds against a wiki, this grounds against the
 * pasted samples: the model must draw voice, temperament, and facts from what's
 * actually there, not invent. Per product decision it populates personality,
 * example dialogue, and description — plus inferred dynamic-state seeds — but
 * NOT voice lines.
 */

/** Cap on sample text fed to the analyzer, to stay within a local model's context. */
const SAMPLE_CHARS = 8000;

export interface EssenceResult {
  card: StudioCard;
  stateSeeds: StateSeed[];
}

function analyzeSystemPrompt(name: string): string {
  const who = name ? `the character "${name}"` : "the main character (not the user)";
  return [
    `You study sample conversation text and distil ${who} into a roleplay character card.`,
    "Ground EVERYTHING in the samples: capture how they actually talk and behave. Do not invent facts, backstory, or traits the samples don't show. If something isn't evidenced, leave it out.",
    "",
    "Fill these fields:",
    "- `personality`: terse bullet-like phrases capturing voice, temperament, and verbal tics. FRONT-LOAD the most distinctive speech traits — this is the essence.",
    "- `exampleDialogue`: 2–4 short `{{char}}:` / `{{user}}:` exchanges that mirror the sample's real cadence and vocabulary (rework, don't copy verbatim).",
    "- `description`: factual details the samples reveal — background, relationships, situation, appearance. Grounded only.",
    "- `name`: their name if the samples make it clear, else \"\".",
    "- `povMode`/`tense`/`dialogueStyle`: structural suggestions matching how the samples read, or \"\".",
    "- `scenario`/`firstMessage`/`alternateGreetings`/`tags`/`voiceLines`: leave empty (\"\" or []).",
    "",
    "Also infer `stateSeeds`: starting values for dynamic story variables the samples imply — e.g. mood, relationship level with the user, current outfit, location. Each is `{label, value}`. Only include ones the samples actually support; return [] if none are evident.",
    "",
    "Output ONLY a JSON object, no prose, no markdown fence:",
    '{"name":"","description":"","personality":"","scenario":"","firstMessage":"","exampleDialogue":"","alternateGreetings":[],"tags":[],"povMode":"","tense":"","dialogueStyle":"","voiceLines":[],"stateSeeds":[{"label":"","value":""}]}',
  ].join("\n");
}

function coerceStateSeeds(parsed: unknown): StateSeed[] {
  const arr = Array.isArray((parsed as Record<string, unknown>)?.stateSeeds)
    ? ((parsed as Record<string, unknown>).stateSeeds as unknown[])
    : [];
  const out: StateSeed[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    const label = asString(s.label);
    const value = asString(s.value);
    if (label && value) out.push({ label, value });
  }
  return out;
}

/** Analyze conversation samples into a grounded card + inferred state seeds. */
export async function analyzeEssence(
  samples: string,
  name: string,
  settings: Settings,
): Promise<EssenceResult> {
  const model = defaultModelFor(settings);
  const trimmedName = name.trim();
  if (!model) return { card: { ...emptyCard(), name: trimmedName }, stateSeeds: [] };

  const excerpt = samples.slice(0, SAMPLE_CHARS);
  const messages: ChatMessage[] = [
    { role: "system", content: analyzeSystemPrompt(trimmedName) },
    { role: "user", content: `Sample conversation:\n\n${excerpt}\n\nWrite the character card JSON now.` },
  ];

  try {
    const provider = getProvider(settings);
    let out = "";
    for await (const delta of provider.streamChat({
      model,
      messages,
      options: {
        temperature: 0.3, // Capture what's there, don't embellish.
        num_ctx: settings.numCtx,
        num_predict: NUM_PREDICT,
      },
    })) {
      out += delta;
    }
    const parsed = extractJson(out);
    const card = coerceCard(parsed);
    card.voiceLines = []; // Product decision: the analyzer never fills voice lines.
    if (trimmedName) card.name = trimmedName;
    return { card, stateSeeds: coerceStateSeeds(parsed) };
  } catch {
    return { card: { ...emptyCard(), name: trimmedName }, stateSeeds: [] };
  }
}
