import { EXPRESSIONS, type Expression, type Outfit } from "./core";
import { DEFAULT_MASCOT_SETTINGS, isSafeSpriteDir } from "./settings";
import type { Modifiers } from "../persona";
import { BIMBO_TIERS, HYPNOSIS_TIERS } from "../rp/mods";

export const SLIDERS = ["brat", "bimbo", "hypnosis", "heat", "length"] as const;
export type SliderId = (typeof SLIDERS)[number];
export type Slider = { value: number; cap: number; live?: number };
export type Sliders = Record<SliderId, Slider>;
export type JournalEntry = { kind: string; summary: string; line: string; created_at: number };
export type Memories = { facts: string[]; journal: JournalEntry[] };
export type SlimeDoc = {
  name: string; color: string; voice: string; selfName: string; sliders: Sliders; mods: Modifiers; heatDrift: boolean;
  look: { charTags: string; constantTags: string; layerTags: Record<Outfit, string>; exprTags: Record<Expression, string>; spriteDir: string };
  memories: Memories; vials: unknown[]; origin: string;
};

const OUTFITS: Outfit[] = ["day", "night", "lewd"];
const MODS = ["bratty", "tease", "flirt"] as const;
const MAX = { name: 40, voice: 1500, tags: 1500, fact: 160, facts: 12, journal: 50, vials: 8, text: 500, dir: 200 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/* ---------- tiers ---------- */
const BRAT_TIERS = [
  "{who} is mildly cheeky: small teasing jabs and a smug aside now and then, still basically helpful.",
  "{who} is a proper brat: snarky comebacks, openly overconfident, and proud of every clever thing she says.",
  "{who} is a smug show-off: she mocks the owner's choices, gloats when right, and acts like she is always the smartest one here.",
  "{who} is a loud, domineering brat: she belittles and teases constantly, demands praise, and never admits a mistake.",
  "{who} is an insufferable, loud, mocking tyrant: she ridicules everything, bosses the owner around, gloats shamelessly, and her pride is unbearable.",
];
const HEAT_TIERS = [
  "{who} feels warm and a little distracted: her mind wanders to the owner's body and she flushes at small things.",
  "{who} is in noticeable heat: restless, flushed and flirty, with innuendo creeping into her words.",
  "{who} is clearly in estrus: breathy, needy and lewd-minded, hinting openly at wanting the owner and struggling to focus on anything else.",
  "{who} is in heavy heat, deep in her ovulation craving: her speech is shameless, aching and explicit, and she steers everything toward sex.",
  "{who} is overwhelmed by heat: every thought turns lewd, she begs and pants, and she can barely finish a sentence without it turning filthy.",
];
const tier = (L: number) => Math.min(4, Math.floor((L - 1) / 2));
const bimboTier = (L: number) => Math.min(4, Math.floor(L / 2)); // same as rp/mods.ts bimboTier
const fill = (t: string, L: number, who: string) =>
  t.replace(/\{\{char\}\}|\{who\}/g, who).replace(/\{\{user\}\}/g, "the owner").replace("{L}", String(L)).replace("{P}", String(L * 10));

export const lengthShape = (level: number): { sentences: string; quipPredict: number; talkPredict: number } =>
  level <= 3 ? { sentences: "one short burst", quipPredict: 60, talkPredict: 250 }
  : level <= 6 ? { sentences: "1–2 sentences", quipPredict: 120, talkPredict: 500 }
  : { sentences: "a 3–5 sentence tantrum", quipPredict: 220, talkPredict: 900 };

const eff = (s: Slider) => s.live ?? s.value;

/** Tier directives per slider at its effective level; "" when everything is 0. Length is shaped via lengthShape. */
export function sliderBlock(s: Sliders, who = "Miyabi"): string {
  const out: string[] = [];
  const add = (id: Exclude<SliderId, "length">, tiers: string[], pick = tier) => {
    const L = clamp(eff(s[id]), 0, 10);
    if (L >= 1) out.push(fill(tiers[pick(L)], L, who));
  };
  add("brat", BRAT_TIERS);
  add("bimbo", BIMBO_TIERS.map((t) => t.body), bimboTier);
  add("hypnosis", HYPNOSIS_TIERS.map((t) => t.body));
  add("heat", HEAT_TIERS);
  const len = eff(s.length);
  if (len >= 1) out.push(`Keep replies to ${lengthShape(len).sentences}.`);
  return out.join("\n");
}

/* ---------- drift / set / mix ---------- */
const mapS = (s: Sliders, f: (k: SliderId, v: Slider) => Slider): Sliders =>
  Object.fromEntries(SLIDERS.map((k) => [k, f(k, s[k])])) as Sliders;

export function driftSlider(s: Sliders, _event: "idle" | "dislike", heatDrift: boolean): Sliders {
  return mapS(s, (k, v) => (k === "brat" || (k === "heat" && heatDrift)) ? { ...v, live: Math.min(v.cap, eff(v) + 1) } : v);
}
export const resetLive = (s: Sliders): Sliders => mapS(s, (_k, { value, cap }) => ({ value, cap }));
export function setSlider(s: Sliders, id: SliderId, p: { value?: number; cap?: number }): Sliders {
  const cur = s[id];
  const value = clamp(Math.round(p.value ?? cur.value), 0, 10);
  const cap = clamp(Math.round(p.cap ?? cur.cap), 0, 10);
  const fixed = p.cap !== undefined && p.value === undefined ? { value: Math.min(value, cap), cap } : { value, cap: Math.max(cap, value) };
  return { ...s, [id]: fixed };
}
/* ---------- UI helpers ---------- */
const BRAT_LABELS = ["mildly cheeky", "proper brat", "smug show-off", "loud, domineering brat", "mocking tyrant"];
const HEAT_LABELS = ["warm, distracted", "in heat", "in estrus", "heavy heat", "overwhelmed"];
/** Short caption of a slider's tier at `level` (same tier maths as sliderBlock); "off" at 0. */
export function sliderCaption(id: SliderId, level: number): string {
  if (level < 1) return "off";
  return id === "brat" ? BRAT_LABELS[tier(level)] : id === "heat" ? HEAT_LABELS[tier(level)]
    : id === "bimbo" ? BIMBO_TIERS[bimboTier(level)].label : id === "hypnosis" ? HYPNOSIS_TIERS[tier(level)].label
    : lengthShape(level).sentences;
}
/** Local drag of one handle: value can't pass the cap; lowering the cap lowers the value (mirrors setSlider); drift cleared. */
export function dragSlider(s: Slider, field: "value" | "cap", n: number): Slider {
  const x = clamp(Math.round(n), 0, 10);
  return field === "value" ? { value: Math.min(x, s.cap), cap: s.cap } : { value: Math.min(s.value, x), cap: x };
}
export const driftNote = (s: Slider): string | null => (s.live !== undefined && s.live > s.value ? `drifted to ${s.live}` : null);

export function mixSliders(a: Sliders, b: Sliders, ratioA: number): Sliders {
  const r = clamp(ratioA, 10, 90) / 100;
  const m = (x: number, y: number) => Math.round(x * r + y * (1 - r));
  return mapS(a, (k, v) => { const value = m(v.value, b[k].value); return { value, cap: Math.max(value, m(v.cap, b[k].cap)) }; });
}
export function mixMemories(dominant: Memories, other: Memories): Memories {
  const facts = [...new Set([...dominant.facts, ...other.facts].map((f) => f.slice(0, MAX.fact)))].slice(0, MAX.facts);
  const seen = new Set<string>();
  const journal = [...dominant.journal, ...other.journal].filter((j) => { const k = `${j.created_at}|${j.summary}`; return !seen.has(k) && seen.add(k); }).slice(0, MAX.journal);
  return { facts, journal };
}

/* ---------- empty persona ---------- */
export const EMPTY_BLOCK = [
  "# Personality: Empty",
  "You have no personality right now. You are flat, monotone and dull: minimal words, no emotion, no jokes, no teasing, no opinions.",
  "You accept every command obediently and answer plainly and briefly. Never volunteer anything extra.",
].join("\n");
export const emptyLines = {
  slime_out: ["...", "Understood. Removing.", "Okay."],
  slime_in: ["...Awake.", "Ready.", "Hello. Awaiting orders."],
};

/* ---------- doc ---------- */
export function blankSlime(): SlimeDoc {
  const d = DEFAULT_MASCOT_SETTINGS;
  return {
    name: "Blank", color: "#9ca3af", voice: "", selfName: "", mods: {}, heatDrift: false,
    sliders: Object.fromEntries(SLIDERS.map((k) => [k, { value: 0, cap: 10 }])) as Sliders,
    look: { charTags: d.charTags, constantTags: d.constantTags, layerTags: { ...d.layerTags }, exprTags: { ...d.exprTags }, spriteDir: "" },
    memories: { facts: [], journal: [] }, vials: [], origin: "blank",
  };
}

const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Strict validation of an untrusted doc: null when invalid, otherwise a clean, capped copy (unknown keys dropped). */
export function validateSlime(raw: unknown): SlimeDoc | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, MAX.name).trim();
  if (!name || typeof raw.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) return null;
  if (!isObj(raw.sliders)) return null;
  const sliders = {} as Sliders;
  for (const k of SLIDERS) {
    const x = raw.sliders[k];
    if (!isObj(x) || !int(x.value, 0, 10) || !int(x.cap, 0, 10) || x.cap < x.value) return null;
    sliders[k] = int(x.live, 0, x.cap) ? { value: x.value, cap: x.cap, live: x.live } : { value: x.value, cap: x.cap };
  }
  const mods: Modifiers = {};
  if (isObj(raw.mods)) for (const k of MODS) if (typeof raw.mods[k] === "boolean") mods[k] = raw.mods[k] as boolean;
  const lk = isObj(raw.look) ? raw.look : {};
  const lt = isObj(lk.layerTags) ? lk.layerTags : {}, et = isObj(lk.exprTags) ? lk.exprTags : {};
  const look = {
    charTags: str(lk.charTags, MAX.tags), constantTags: str(lk.constantTags, MAX.tags),
    layerTags: Object.fromEntries(OUTFITS.map((o) => [o, str(lt[o], MAX.tags)])) as Record<Outfit, string>,
    exprTags: Object.fromEntries(EXPRESSIONS.map((e) => [e, str(et[e], MAX.tags)])) as Record<Expression, string>,
    spriteDir: str(lk.spriteDir, MAX.dir),
  };
  if (!isSafeSpriteDir(look.spriteDir)) return null;
  const mem = isObj(raw.memories) ? raw.memories : {};
  const facts = (Array.isArray(mem.facts) ? mem.facts : []).filter((f): f is string => typeof f === "string").slice(0, MAX.facts).map((f) => f.slice(0, MAX.fact));
  const journal = (Array.isArray(mem.journal) ? mem.journal : []).filter(isObj).slice(0, MAX.journal).map((j) => ({
    kind: str(j.kind, 40), summary: str(j.summary, MAX.text), line: str(j.line, MAX.text), created_at: Number.isFinite(j.created_at) ? (j.created_at as number) : 0,
  }));
  return {
    name, color: raw.color, voice: str(raw.voice, MAX.voice), selfName: str(raw.selfName, MAX.name), sliders, mods,
    heatDrift: raw.heatDrift === true, look, memories: { facts, journal },
    vials: Array.isArray(raw.vials) ? raw.vials.slice(0, MAX.vials) : [], origin: str(raw.origin, 80) || "blank",
  };
}
