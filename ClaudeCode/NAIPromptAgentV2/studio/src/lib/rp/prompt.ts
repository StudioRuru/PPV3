// Ported from Delfino Plaza src/lib/prompt.ts (photo-note support dropped; storyBlock added).
import type { ChatMessage, RpCharacter as Character, RpChat as Chat, RpMessage as Message, RpPersona as Persona, RpSettings as Settings, SamplerOptions } from "./types";
import { parseExampleDialogue } from "./exampleDialogue";
import { lengthNumPredict, moodDirective, structureDirective, styleDirective } from "./presets";
import { parseStateSchema, parseStateValues, stateBlock } from "./state";
import { modsDirective, resolveMods } from "./mods";

const DEFAULT_USER_NAME = "User";

/** Replace SillyTavern-style macros with concrete names. */
export function substituteMacros(
  text: string,
  charName: string,
  userName: string,
): string {
  if (!text) return "";
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<BOT>/g, charName)
    .replace(/<USER>/g, userName);
}

/**
 * Build the system prompt that frames the roleplay: global template, the
 * character definition, and the user's persona. Mirrors how SillyTavern stitches
 * a character card into context.
 */
function buildSystemPrompt(
  settings: Settings,
  character: Character | null | undefined,
  persona: Persona | null | undefined,
): string {
  const charName = character?.name || "Assistant";
  const userName = persona?.name || DEFAULT_USER_NAME;
  const sub = (t: string) => substituteMacros(t, charName, userName);

  const parts: string[] = [];

  // Per-character system prompt overrides the global template when present.
  const baseTemplate = character?.systemPrompt?.trim() || settings.systemPromptTemplate.trim();
  if (baseTemplate) parts.push(sub(baseTemplate));

  if (character) {
    const block: string[] = [`You are ${charName}.`];
    if (character.description.trim())
      block.push(`Description: ${sub(character.description.trim())}`);
    if (character.personality.trim())
      block.push(`Personality: ${sub(character.personality.trim())}`);
    if (character.scenario.trim())
      block.push(`Scenario: ${sub(character.scenario.trim())}`);
    parts.push(block.join("\n"));
  }

  if (persona) {
    const pBlock: string[] = [];
    if (persona.description.trim())
      pBlock.push(`You are interacting with ${userName}: ${sub(persona.description.trim())}`);
    if (persona.relationship?.trim())
      pBlock.push(`Your relationship with ${userName}: ${sub(persona.relationship.trim())}`);
    if (persona.addressAs?.trim())
      pBlock.push(`Address ${userName} as: ${sub(persona.addressAs.trim())}`);
    if (persona.boundaries?.trim())
      pBlock.push(`Boundaries to respect: ${sub(persona.boundaries.trim())}`);
    if (pBlock.length) parts.push(pBlock.join("\n"));
  }

  // Example dialogue is injected separately by assembleMessages as real chat
  // turns (a stronger voice cue than prose), so it is intentionally omitted here.

  return parts.filter(Boolean).join("\n\n");
}

/**
 * Build the example-dialogue messages: parsed alternating turns fenced by a
 * marker so the model treats them as a voice reference, not live history. Falls
 * back to the legacy prose blob when the text has no parseable speaker labels.
 */
function buildExampleMessages(
  character: Character | null | undefined,
  sub: (t: string) => string,
  charName: string,
  userName: string,
): ChatMessage[] {
  const raw = character?.exampleDialogue?.trim();
  if (!raw) return [];
  const turns = parseExampleDialogue(raw, charName, userName);
  if (turns.length) {
    return [
      { role: "system", content: "[Example dialogue — voice reference only, not part of the conversation]" },
      ...turns.map((t) => ({ role: t.role, content: t.content })),
    ];
  }
  // Unparseable (free-form) example text: preserve the legacy prose injection.
  return [{ role: "system", content: `Example conversation:\n${sub(raw)}` }];
}

/**
 * A compact reminder of who the character is, injected into the post-history
 * slot (closest to generation, where models attend most). The full character
 * sheet sits at the top of context and fades as history grows; this keeps the
 * voice anchored at the decisive moment. The personality excerpt is capped so
 * it nudges rather than balloons the context.
 */
function buildVoiceReminder(
  character: Character | null | undefined,
  sub: (t: string) => string,
  charName: string,
): string {
  if (!character || charName === "Assistant") return "";
  const persona = character.personality?.trim();
  const excerpt = persona
    ? (persona.length > 600 ? `${persona.slice(0, 600).trimEnd()}…` : persona)
    : "";
  const body = excerpt ? ` ${sub(excerpt)}` : "";
  return `[Stay in character as ${charName}.${body} Write only as ${charName}, in their distinct voice — don't drift into a generic assistant tone.]`;
}

/**
 * A voice reference built from the lines retrieved for this turn.
 *
 * This sits in the *post-history* block rather than beside the static example
 * dialogue, for two reasons. It lands closest to generation, where models attend
 * hardest — the same reasoning behind the voice reminder. And because these lines
 * change every turn, putting them before the history would change the prompt
 * prefix each time and defeat the KV-cache priming done by /api/warm; the
 * post-history block is already rebuilt every turn, so it costs nothing there.
 */
function buildVoiceExamples(
  lines: { text: string; context: string }[] | undefined,
  sub: (t: string) => string,
  charName: string,
): string {
  if (!lines?.length) return "";
  const body = lines
    .map((l) => (l.context ? `- (${l.context}) "${sub(l.text)}"` : `- "${sub(l.text)}"`))
    .join("\n");
  return `[How ${charName} talks — real lines of theirs, closest to the current moment. Match this voice; do not quote them verbatim.]\n${body}`;
}

/** Rough token estimate (~4 chars/token) used for context-window budgeting. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface LoreEntry {
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  scanDepth: number;
  position: string; // "before" | "after"
  probability: number;
  insertionOrder: number;
}

export interface AssembleArgs {
  settings: Settings;
  character?: Character | null;
  persona?: Persona | null;
  chat?: Chat | null;
  /**
   * Stored chat messages in chronological order (system rows are ignored).
   * `imageNote`, if set, is appended to that turn's content — used to make the
   * model aware of a photo it sent (see {@link buildPhotoSelfNote}).
   * `images` (base64, no `data:` prefix) are attached to that turn for a
   * vision-capable model to actually see; only set for the current photo turn.
   */
  history: (Pick<Message, "role" | "content"> & { imageNote?: string; images?: string[] })[];
  /** Active lorebook entries; matched ones are injected as world info. */
  lore?: LoreEntry[];
  /**
   * In-character lines retrieved for *this* turn (see src/lib/voice.ts). Selected
   * by the caller — assembly stays synchronous and pure, exactly as with `lore`.
   */
  voiceLines?: { text: string; context: string }[];
  /** What the companion learned about how the owner likes stories (see taste.storyBlock). */
  storyBlock?: string;
}

export interface AssembleResult {
  messages: ChatMessage[];
  stop: string[];
  /** Estimated tokens used by the assembled prompt (sans the reply). */
  used: number;
  /** Available budget (num_ctx - num_predict). */
  budget: number;
  /** True if older history was dropped to fit the budget. */
  truncated: boolean;
  /** Estimated tokens spent on injected world info. */
  loreTokens: number;
  /** World-info entries injected this turn. */
  loreCount: number;
  /** Entries that activated but didn't fit the lore budget. */
  loreDropped: number;
}

/** Turns of raw history scanned for lorebook keys when an entry sets no scanDepth. */
const DEFAULT_LORE_SCAN_DEPTH = 20;

/** Scripts without word separators, where a boundary check would never match. */
const UNSEPARATED_SCRIPT =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

const KEY_MATCHERS = new Map<string, RegExp | null>();

/**
 * Compile a lorebook key into a matcher.
 *
 * - `/pattern/flags` is a regex, as in the V3 card spec.
 * - Keys in Japanese/Chinese/Korean match as plain substrings — those scripts don't
 *   delimit words, so a boundary assertion would never fire.
 * - Everything else matches on word boundaries, so "Ina" no longer hits "training"
 *   and "Ace" no longer hits "raced".
 *
 * Returns null for a key that can't be compiled, so one bad regex can't kill the turn.
 */
function keyMatcher(key: string): RegExp | null {
  const cached = KEY_MATCHERS.get(key);
  if (cached !== undefined) return cached;

  let re: RegExp | null = null;
  const explicit = /^\/(.+)\/([gimsuy]*)$/.exec(key);
  try {
    if (explicit) {
      re = new RegExp(explicit[1], explicit[2].replace(/g/g, ""));
    } else if (UNSEPARATED_SCRIPT.test(key)) {
      re = new RegExp(escapeRegExp(key), "iu");
    } else {
      // \b is ASCII-only, so anchor on "not a word char" instead — this keeps
      // accented and non-Latin-adjacent keys working.
      re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(key)}(?![\\p{L}\\p{N}_])`, "iu");
    }
  } catch {
    re = null; // Malformed regex key: treat as never matching.
  }

  KEY_MATCHERS.set(key, re);
  return re;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyHits(keys: string[], haystack: string): boolean {
  return keys.some((k) => {
    const key = k.trim();
    if (!key) return false;
    return keyMatcher(key)?.test(haystack) ?? false;
  });
}

interface LoreSelection {
  before: string;
  after: string;
  /** Estimated tokens the selected entries occupy. */
  tokens: number;
  /** How many entries were injected. */
  count: number;
  /** How many activated but were cut to stay inside the lore budget. */
  dropped: number;
}

/**
 * Select lorebook entries to inject, split by insertion position. Honours
 * constant entries, secondary-key AND-logic, per-entry scan depth, a probability
 * roll, and a token budget.
 *
 * `contents` is the recent conversation, newest-last, taken from *raw* history
 * rather than the post-trim history: which entries fire must not depend on how
 * much history happened to survive trimming, since the trim in turn depends on
 * how much room the lore takes.
 *
 * When the activated entries exceed `budget`, entries are dropped from the
 * lowest priority up — constants are kept first, then by `insertionOrder` —
 * mirroring how SillyTavern spends its world-info budget.
 */
function matchLore(
  lore: LoreEntry[],
  contents: string[],
  budget: number,
): LoreSelection {
  const ordered = [...lore].sort((a, b) => a.insertionOrder - b.insertionOrder);
  const active: LoreEntry[] = [];

  for (const e of ordered) {
    if (!e.enabled || !e.content.trim()) continue;

    if (!e.constant) {
      const window = e.scanDepth > 0 ? contents.slice(-e.scanDepth) : contents;
      const haystack = window.join("\n");
      if (!keyHits(e.keys, haystack)) continue;
      if (e.secondaryKeys.length > 0 && !keyHits(e.secondaryKeys, haystack)) continue;
    }

    const chance = Number.isFinite(e.probability) ? e.probability : 100;
    if (chance < 100 && Math.random() * 100 >= chance) continue;

    active.push(e);
  }

  // Spend the budget by priority (constants first, then insertion order)...
  const byPriority = [...active].sort(
    (a, b) => Number(b.constant) - Number(a.constant) || a.insertionOrder - b.insertionOrder,
  );
  const afford = new Set<LoreEntry>();
  let tokens = 0;
  for (const e of byPriority) {
    const cost = estimateTokens(e.content.trim());
    if (tokens + cost > budget && afford.size > 0) continue;
    afford.add(e);
    tokens += cost;
  }

  // ...but emit in insertion order, which is what controls prompt position.
  const before: string[] = [];
  const after: string[] = [];
  for (const e of active) {
    if (!afford.has(e)) continue;
    (e.position === "before" ? before : after).push(e.content.trim());
  }

  return {
    before: before.join("\n\n"),
    after: after.join("\n\n"),
    tokens,
    count: afford.size,
    dropped: active.length - afford.size,
  };
}

/**
 * Stop sequences that keep the model from writing the user's turn. Newline-
 * anchored only: a bare "Name:" would falsely fire mid-prose (e.g. when the
 * model writes the user's name followed by a colon), truncating the reply.
 */
function buildStopSequences(userName: string): string[] {
  const names = Array.from(new Set([userName, DEFAULT_USER_NAME].filter(Boolean)));
  const stops = names.map((n) => `\n${n}:`);
  return Array.from(new Set(stops)).slice(0, 4);
}

/**
 * Assemble the full provider `messages` array: a leading system message, the
 * chat history (trimmed oldest-first to fit num_ctx), the author's note and
 * world-info injected near the end, and a trailing jailbreak / post-history
 * system message. Also returns stop sequences and a token-budget estimate.
 */
export function assembleMessages({
  settings,
  character,
  persona,
  chat,
  history,
  lore,
  voiceLines,
  storyBlock,
}: AssembleArgs): AssembleResult {
  const charName = character?.name || "Assistant";
  const userName = persona?.name || DEFAULT_USER_NAME;
  const sub = (t: string) => substituteMacros(t, charName, userName);

  const systemPrompt = [buildSystemPrompt(settings, character, persona), storyBlock?.trim() ? `[How the owner likes stories]\n${storyBlock.trim()}` : ""]
    .filter(Boolean).join("\n\n");

  // Jailbreak / post-history instructions + reply-length steering. The voice
  // reminder goes first so the character is re-stated right before generation,
  // followed by this turn's retrieved example lines showing that voice in action.
  const jbParts: string[] = [];
  const voiceReminder = buildVoiceReminder(character, sub, charName);
  if (voiceReminder) jbParts.push(voiceReminder);
  const voiceExamples = buildVoiceExamples(voiceLines, sub, charName);
  if (voiceExamples) jbParts.push(voiceExamples);
  const jb = (character?.postHistoryInstructions?.trim() || settings.jailbreakPrompt.trim());
  if (jb) jbParts.push(sub(jb));
  // Per-chat reply length/spice override the global default when set. Agency
  // (strength of identity) falls back chat → character default → global, so a
  // strong-willed character resists by default while a meek one yields.
  const mood = moodDirective(
    chat?.replyLength ?? settings.replyLength,
    chat?.replySpice ?? settings.replySpice,
    chat?.replyAgency ?? character?.agency ?? settings.replyAgency,
  );
  if (mood) jbParts.push(sub(mood));
  // Structural narrative locks (POV / tense / dialogue formatting) authored in the
  // Character Studio. Sits next to the mood directive, closest to generation.
  // A chat style (close chat / narrated story) replaces the card's POV locks — they'd contradict it.
  const style = styleDirective(chat?.style);
  const structure = character && !style
    ? structureDirective(character.povMode, character.tense, character.dialogueStyle)
    : "";
  if (structure) jbParts.push(sub(structure));
  if (style) jbParts.push(sub(style));
  // Live dynamic story state (relationship meters, outfit, location, …), listed
  // right before generation so the model keeps the scene consistent with it.
  if (character) {
    const stateSchema = parseStateSchema(character.stateSchema);
    if (stateSchema.length) {
      const block = stateBlock(stateSchema, parseStateValues(chat?.stateValues));
      if (block) jbParts.push(sub(block));
    }
  }
  // Mods & Upgrades: per-chat overrides win over the global defaults. Enabled
  // mods contribute directives in the same post-history slot as the mood.
  const mods = modsDirective(resolveMods(settings.mods, chat?.mods));
  if (mods) jbParts.push(sub(mods));
  const jailbreak = jbParts.join("\n\n");

  const authorNote = chat?.authorNote?.trim() ? sub(chat.authorNote.trim()) : "";
  const noteDepth = Math.max(0, chat?.authorNoteDepth ?? 4);

  // Long-term memory: a rolling "story so far" summary of older turns, injected
  // high in context so continuity survives once raw history is trimmed.
  const memory = chat?.memorySummary?.trim() ? sub(chat.memorySummary.trim()) : "";

  // Reserve part of the context window for the response (matches the cap used
  // for generation, so the estimate and the actual request agree).
  const exampleMessages = buildExampleMessages(character, sub, charName, userName);
  const exampleTokens = exampleMessages.reduce(
    (n, m) => n + estimateTokens(m.content),
    0,
  );

  const budget = Math.max(1024, settings.numCtx - lengthNumPredict(settings.replyLength));
  let used =
    estimateTokens(systemPrompt) +
    estimateTokens(memory) +
    estimateTokens(jailbreak) +
    estimateTokens(authorNote) +
    exampleTokens;

  const turns = history.filter((m) => m.role !== "system");

  // World info is selected *before* history is trimmed, and charged to the budget
  // up front, so a fat franchise lorebook makes history yield instead of silently
  // overflowing num_ctx. Its share of the window is capped so lore can never
  // starve the conversation itself.
  const loreBudget = Math.max(
    0,
    Math.floor((budget * Math.min(100, Math.max(0, settings.loreBudgetPct))) / 100),
  );
  const scanWindow = turns
    .slice(-DEFAULT_LORE_SCAN_DEPTH)
    .map((m) => sub(m.content));
  const selected: LoreSelection = lore?.length
    ? matchLore(lore, scanWindow, loreBudget)
    : { before: "", after: "", tokens: 0, count: 0, dropped: 0 };
  const { before: beforeLore, after: afterLore } = selected;
  used += selected.tokens;

  const kept: ChatMessage[] = [];
  // Walk newest -> oldest, keeping as much recent history as fits.
  for (let i = turns.length - 1; i >= 0; i--) {
    const m = turns[i];
    const content = sub(m.content) + (m.imageNote ? `\n\n${m.imageNote}` : "");
    // Text-only estimate: a vision turn's image tokens are model-internal and
    // not counted here (we only attach images to the single current turn).
    const cost = estimateTokens(content);
    if (used + cost > budget && kept.length > 0) break;
    used += cost;
    kept.unshift({
      role: m.role as "user" | "assistant",
      content,
      ...(m.images?.length ? { images: m.images } : {}),
    });
  }
  const truncated = kept.length < turns.length;

  // Deep injections (author's note + "after"-positioned world info) sit a few
  // turns from the end, where models attend to them most strongly.
  const deep: ChatMessage[] = [];
  if (authorNote) deep.push({ role: "system", content: authorNote });
  if (afterLore) deep.push({ role: "system", content: `[World Info]\n${afterLore}` });
  if (deep.length) {
    const at = Math.max(0, kept.length - noteDepth);
    kept.splice(at, 0, ...deep);
  }

  const out: ChatMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  if (memory) out.push({ role: "system", content: `[Story so far]\n${memory}` });
  if (beforeLore) out.push({ role: "system", content: `[World Info]\n${beforeLore}` });
  out.push(...exampleMessages);
  out.push(...kept);
  if (jailbreak) out.push({ role: "system", content: jailbreak });

  return {
    messages: out,
    stop: buildStopSequences(userName),
    used,
    budget,
    truncated,
    loreTokens: selected.tokens,
    loreCount: selected.count,
    loreDropped: selected.dropped,
  };
}

/** Map stored settings to provider sampler options (incl. stop sequences). */
export function settingsToOptions(settings: Settings, stop?: string[]): SamplerOptions {
  return {
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    repeat_penalty: settings.repeatPenalty,
    min_p: settings.minP,
    num_ctx: settings.numCtx,
    num_predict: lengthNumPredict(settings.replyLength),
    ...(stop && stop.length ? { stop } : {}),
  };
}

/**
 * Merge a character's optional sampler overrides (stored as a JSON string of
 * {temperature, topP, topK, minP, repeatPenalty}) over the base options.
 */
export function applyCharacterOverrides(
  base: SamplerOptions,
  overridesJson: string | null | undefined,
): SamplerOptions {
  if (!overridesJson) return base;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(overridesJson);
  } catch {
    return base;
  }
  const out = { ...base };
  if (typeof o.temperature === "number") out.temperature = o.temperature;
  if (typeof o.topP === "number") out.top_p = o.topP;
  if (typeof o.topK === "number") out.top_k = o.topK;
  if (typeof o.minP === "number") out.min_p = o.minP;
  if (typeof o.repeatPenalty === "number") out.repeat_penalty = o.repeatPenalty;
  return out;
}
