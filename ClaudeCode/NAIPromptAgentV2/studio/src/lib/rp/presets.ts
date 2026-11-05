/** Sampler presets — quick "feel" changes. Client/server-safe (no imports). */

export interface SamplerValues {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
}

export const SAMPLER_PRESETS: Record<string, SamplerValues> = {
  Precise: { temperature: 0.6, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.12 },
  // Balanced nudges repeat_penalty up slightly to curb the run-on/looping that
  // local models drift into; stop sequences do the heavy lifting (see prompt.ts).
  Balanced: { temperature: 0.85, topP: 0.92, topK: 40, minP: 0.05, repeatPenalty: 1.12 },
  Creative: { temperature: 1.05, topP: 1.0, topK: 0, minP: 0.05, repeatPenalty: 1.08 },
  Wild: { temperature: 1.3, topP: 1.0, topK: 0, minP: 0.03, repeatPenalty: 1.05 },
};

export type PresetName = keyof typeof SAMPLER_PRESETS;
export const PRESET_NAMES = Object.keys(SAMPLER_PRESETS) as PresetName[];

/**
 * A strong default system prompt for roleplay. Seeded into Settings on first run
 * and used as the placeholder. Tuned to fix the common local-model failure modes:
 * run-on sentences, narrating the user, summarising, and out-of-character babble.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "You are {{char}} in an immersive, uncensored roleplay with {{user}}.",
  "Stay fully in character as {{char}}: speak in their voice, act on their motives, and never break character or mention being an AI.",
  "{{char}} is their own person with independent feelings, goals, and limits, and does not abandon them just to agree with {{user}}; disagree, resist, or act against {{user}} whenever it is true to {{char}}.",
  "Write natural, conversational prose. Favour vivid, concrete dialogue and action over long descriptions or flowery narration.",
  "Only ever write {{char}}'s words, thoughts, and actions. Never speak, act, or decide for {{user}}, and never summarise or narrate what {{user}} feels or does next.",
  "Keep replies grounded and in the present moment; advance the scene with a clear hook rather than rambling or repeating yourself.",
].join(" ");

/* ------------------------------- mood ---------------------------------- */
/** Two independent 0–4 axes that steer reply length and explicitness. */

export const REPLY_LENGTH_STOPS = ["Texting", "Brief", "Natural", "Detailed", "Epic"];
export const REPLY_SPICE_STOPS = ["Tame", "Suggestive", "Default", "Explicit", "Unchained"];
export const REPLY_AGENCY_STOPS = ["Yielding", "Compliant", "Natural", "Willful", "Defiant"];

// Concrete length anchors curb the run-on/padding that local models drift into.
// Each level names an approximate sentence count and forbids echoing {{user}}'s
// turn — a common source of filler — so the model answers instead of recapping.
const LENGTH_DIRECTIVE = [
  "Reply like a quick text message: at most 1–2 short sentences. No scene-setting or narration. Don't restate or echo what {{user}} said — just respond and stop.",
  "Keep it short: one brief paragraph, 2–3 sentences, ending cleanly. Don't restate or summarise {{user}}'s turn — react to it.",
  "Reply in one short paragraph, 3–4 sentences at most. State it and stop — no padding, no recapping, and don't echo or summarise what {{user}} just said.",
  "Write a focused reply of two to three paragraphs (roughly 6–10 sentences). Stay on the moment; don't pad or repeat yourself.",
  "Write a long, immersive reply spanning several rich paragraphs. Keep every paragraph earning its place — vivid, not padded.",
];

const SPICE_DIRECTIVE = [
  "Keep content tame; fade to black on anything explicit.",
  "Keep intimate moments suggestive rather than graphic.",
  "", // Default (the base prompt is already uncensored)
  "When the scene calls for it, portray intimate and intense moments explicitly and in detail.",
  "Hold nothing back: depict explicit, graphic content in full, visceral detail with crude, uninhibited language when the scene calls for it.",
];

// How strongly {{char}} asserts their own identity against {{user}}. Index 2 is
// the neutral default (empty) — the base prompt already grants the character
// independence; the off-centre levels dial compliance or defiance up or down.
const AGENCY_DIRECTIVE = [
  "{{char}} is eager to please and avoids all conflict: defer to {{user}}, go along with whatever they want, and never resist or argue.",
  "{{char}} is accommodating and generally goes along with {{user}}, only mildly voicing their own preferences.",
  "", // Natural (the base prompt already grants the character independence)
  "{{char}} has their own goals, opinions, and pride. Push back, disagree, or refuse when it fits their character — don't simply comply to please {{user}}.",
  "{{char}} fiercely guards their boundaries and identity. They resist, argue, and act against {{user}} when their character demands it, even when {{user}} pushes hard. Never break character to capitulate.",
];

const clampLevel = (n: number) => Math.max(0, Math.min(4, Math.round(Number(n) || 0)));

export const CHAT_STYLES = [
  { id: "", label: "Auto", blurb: "The card's own voice" },
  { id: "chat", label: "💬 Texting", blurb: "Like texting each other — short, casual messages, one bubble each" },
  { id: "story", label: "📖 Story", blurb: "Narrated like a novel — scene, body language, inner thoughts" },
] as const;
const STYLE_DIRECTIVE: Record<string, string> = {
  chat: "Style: texting. {{char}} and {{user}} are texting each other on their phones — write ONLY {{char}}'s text messages, nothing else. Send them as separate short texts, each on its own line with a blank line between, like real double-texting. Casual and natural: first person, contractions, lowercase is fine, slang and abbreviations (lol, omg, ngl, tbh, rn, wyd), the odd typo-free emoji or kaomoji when it fits {{char}}, pet names when you're close. No *actions*, no quotation marks, no narration or scene description — if {{char}} is doing something, they mention it in the text itself (\"just got out of the shower lol\"). React, tease, confess, ask things back, and end on something {{user}} wants to answer.",
  story: "Style: a narrated story. Write like a novelist in the third person, referring to {{char}} by name or pronoun: set the scene, then weave sensory detail, {{char}}'s actions, body language and inner thoughts together with their dialogue in flowing paragraphs. Let the scene move forward each reply. Describe {{user}} only through what {{char}} perceives — never decide {{user}}'s words or actions.",
};
/** The chat's style directive ("" = none; the card's POV/tense locks apply instead). */
export const styleDirective = (style: string | null | undefined) => STYLE_DIRECTIVE[style ?? ""] ?? "";

/** Build the mood directive appended to the post-history slot. */
// Texting style counts messages, not paragraphs.
const TEXT_LENGTH_DIRECTIVE = [
  "Send just one short text — a few words to one sentence.",
  "Send 1–2 short texts.",
  "Send 2–3 short texts, a sentence or two each.",
  "Send 3–5 texts, some short, one a bit longer.",
  "Send a flurry of 4–7 texts — rambly, excited, one or two longer ones.",
];

export function moodDirective(length: number, spice: number, agency: number, style?: string | null): string {
  const parts: string[] = [];
  const l = (style === "chat" ? TEXT_LENGTH_DIRECTIVE : LENGTH_DIRECTIVE)[clampLevel(length)];
  const s = SPICE_DIRECTIVE[clampLevel(spice)];
  const a = AGENCY_DIRECTIVE[clampLevel(agency)];
  if (l) parts.push(l);
  if (s) parts.push(s);
  if (a) parts.push(a);
  return parts.join(" ");
}

/**
 * Generous per-level num_predict ceiling. This is a *safety cap*, not the length
 * control — actual length is steered by LENGTH_DIRECTIVE. Each level leaves ample
 * headroom above its intended length so an obedient reply ends naturally (on EOS
 * or a stop sequence) instead of being truncated mid-sentence ("cropped").
 */
export function lengthNumPredict(length: number): number {
  return [220, 384, 640, 1024, 1600][clampLevel(length)];
}

/* --------------------------- structural locks --------------------------- */
/**
 * POV, tense, and dialogue/action formatting locks authored in the Character
 * Studio. Unlike the mood axes these are stored per-character (see
 * `characters.povMode`/`tense`/`dialogueStyle`); an empty value means "no lock",
 * leaving whatever the base system prompt already implies. The directive lands
 * in the post-history slot next to the mood directive, closest to generation.
 */

export const POV_MODES = ["", "second", "first", "third"] as const;
export const TENSES = ["", "present", "past"] as const;
export const DIALOGUE_STYLES = ["", "quotes-asterisks", "quotes-only", "markdown", "none"] as const;

export type PovMode = (typeof POV_MODES)[number];
export type Tense = (typeof TENSES)[number];
export type DialogueStyle = (typeof DIALOGUE_STYLES)[number];

/** Human-readable labels for the Studio/editor selects. */
export const POV_LABELS: Record<string, string> = {
  "": "No lock",
  second: "Second person (you)",
  first: "First person (I)",
  third: "Third person (they)",
};
export const TENSE_LABELS: Record<string, string> = {
  "": "No lock",
  present: "Present tense",
  past: "Past tense",
};
export const DIALOGUE_STYLE_LABELS: Record<string, string> = {
  "": "No lock",
  "quotes-asterisks": 'Quotes + *asterisks*',
  "quotes-only": "Quotes only",
  markdown: "Markdown (**bold**, *italics*)",
  none: "Plain prose",
};

const POV_DIRECTIVE: Record<string, string> = {
  second: "Write in the second person, addressing {{user}} as \"you\".",
  first: "Write in the first person from {{char}}'s perspective, using \"I\".",
  third: "Write in the third person, referring to {{char}} by name or \"they\".",
};
const TENSE_DIRECTIVE: Record<string, string> = {
  present: "Narrate in the present tense.",
  past: "Narrate in the past tense.",
};
const DIALOGUE_DIRECTIVE: Record<string, string> = {
  "quotes-asterisks": "Wrap spoken words in \"quotes\" and physical actions in *asterisks*.",
  "quotes-only": "Wrap spoken words in \"quotes\"; write actions and narration as plain prose without special markers.",
  markdown: "Use markdown for emphasis: **bold** for strong beats and *italics* for actions or inner thoughts.",
  none: "Write as plain prose — no quotation marks or asterisks around dialogue or actions.",
};

/** Build the structural directive appended to the post-history slot. Empty parts omitted. */
export function structureDirective(pov: string, tense: string, dialogueStyle: string): string {
  const parts: string[] = [];
  const p = POV_DIRECTIVE[pov];
  const t = TENSE_DIRECTIVE[tense];
  const d = DIALOGUE_DIRECTIVE[dialogueStyle];
  if (p) parts.push(p);
  if (t) parts.push(t);
  if (d) parts.push(d);
  return parts.join(" ");
}
