import { EXPRESSIONS, type Expression, type Outfit } from "./core";
import type { Modifiers } from "../persona";

export type MascotSettings = {
  show: boolean; cooldownMs: number; nightFrom: number; nightTo: number; pin: Outfit | null; mods: Modifiers;
  charTags: string; constantTags: string; layerTags: Record<Outfit, string>; exprTags: Record<Expression, string>;
  corner: "br" | "bl" | "tr" | "tl"; size: "s" | "m" | "l";
};

const OUTFITS: Outfit[] = ["day", "night", "lewd"];
const CORNERS = ["br", "bl", "tr", "tl"];
export const SIZES = ["s", "m", "l"] as const;
const MODS = ["bratty", "tease", "flirt"] as const;
const MAX_TAGS = 1500;

export const DEFAULT_MASCOT_SETTINGS: MascotSettings = {
  show: true, cooldownMs: 120000, nightFrom: 23, nightTo: 7, pin: null, mods: { bratty: true, tease: true, flirt: true }, corner: "br", size: "m",
  charTags: "1girl, solo, hoshimi miyabi, fox girl, animal ears, fox ears, very long hair, black hair, gradient hair, purple hair tips, twintails, blunt bangs, sidelocks, red eyes, purple eyeshadow, eyeliner, fang, heart earrings, heart ear ornament, black choker, heart choker, ring, large breasts, wide hips, thick thighs, curvy",
  constantTags: "black elbow gloves, fingerless gloves, black thighhighs, shiny thighhighs, lace-trimmed thighhighs, heart thigh strap, platform heels",
  layerTags: {
    day: "white crop top, sleeveless, underboob, aqua skirt, frilled miniskirt, pleated skirt, lace panties",
    night: "black leotard, latex leotard, highleg leotard, strapless leotard, plunging neckline, cleavage",
    lewd: "completely nude, nipples, pussy",
  },
  exprTags: {
    smug: "smug, smirk, half-closed eyes, fang",
    laughing: "laughing, open mouth, closed eyes, fang",
    wink: "one eye closed, tongue out, :p",
    pout: "pout, puffed cheeks, bubble blowing, chewing gum",
    flirty: "seductive smile, blush, half-closed eyes, heart-shaped pupils",
    shocked: "surprised, wide-eyed, open mouth, sweat",
    annoyed: "annoyed, frown, glaring, v-shaped eyebrows",
    excited: "excited, open smile, sparkling eyes, fang",
    sleepy: "sleepy, half-closed eyes, yawning, tears",
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const tags = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TAGS;
const hour = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23;

/** Apply valid fields of an untrusted patch onto cur; invalid fields are ignored. */
export function mergeMascotSettings(cur: MascotSettings, patch: unknown): MascotSettings {
  if (!isObj(patch)) return cur;
  const out: MascotSettings = { ...cur, mods: { ...cur.mods }, layerTags: { ...cur.layerTags }, exprTags: { ...cur.exprTags } };
  if (typeof patch.show === "boolean") out.show = patch.show;
  if (patch.cooldownMs === null) out.cooldownMs = Infinity; // JSON has no Infinity: null = only when tapped
  else if (typeof patch.cooldownMs === "number" && patch.cooldownMs >= 30000 && patch.cooldownMs <= 600000) out.cooldownMs = patch.cooldownMs;
  if (hour(patch.nightFrom)) out.nightFrom = patch.nightFrom;
  if (hour(patch.nightTo)) out.nightTo = patch.nightTo;
  if (patch.pin === null || OUTFITS.includes(patch.pin as Outfit)) { if (patch.pin !== undefined) out.pin = patch.pin as Outfit | null; }
  if (CORNERS.includes(patch.corner as string)) out.corner = patch.corner as MascotSettings["corner"];
  if (SIZES.includes(patch.size as MascotSettings["size"])) out.size = patch.size as MascotSettings["size"];
  if (tags(patch.charTags)) out.charTags = patch.charTags;
  if (tags(patch.constantTags)) out.constantTags = patch.constantTags;
  if (isObj(patch.mods)) for (const k of MODS) if (typeof patch.mods[k] === "boolean") out.mods[k] = patch.mods[k];
  if (isObj(patch.layerTags)) for (const k of OUTFITS) if (tags(patch.layerTags[k])) out.layerTags[k] = patch.layerTags[k];
  if (isObj(patch.exprTags)) for (const k of EXPRESSIONS) if (tags(patch.exprTags[k])) out.exprTags[k] = patch.exprTags[k];
  return out;
}

export function parseMascotSettings(json: string | null): MascotSettings {
  if (!json) return DEFAULT_MASCOT_SETTINGS;
  try { return mergeMascotSettings(DEFAULT_MASCOT_SETTINGS, JSON.parse(json)); } catch { return DEFAULT_MASCOT_SETTINGS; }
}
