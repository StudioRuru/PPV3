import { EXPRESSIONS, type Expression, type Outfit } from "./core";
import { PERSONAS, type Modifiers } from "../persona";
import type { Sliders } from "./slime"; // type only: slime.ts imports this module's defaults
import { CAL_ZERO, mergeCalibration, type Calibration } from "./island";
import { validateAppliedVial, type AppliedVial } from "./vial"; // runtime cycle (vial → slime → settings) is safe: only used inside functions

export type MascotSettings = {
  show: boolean; cooldownMs: number; nightFrom: number; nightTo: number; pin: Outfit | null; mods: Modifiers;
  charTags: string; constantTags: string; layerTags: Record<Outfit, string>; exprTags: Record<Expression, string>;
  corner: "br" | "bl" | "tr" | "tl"; size: "s" | "m" | "l";
  /** Live identity (the active slime): voice, name, sliders, sprite dir under data/mascot; empty = no slime inserted. */
  voice: string; selfName: string; sliders: Sliders; heatDrift: boolean; spriteDir: string; empty: boolean;
  /** Potions applied to the active slime (changed only via the vials API). */
  vials: AppliedVial[];
  /** Settings → "Unlock the slime shelf". */
  shelf: boolean;
  /** Stage: how often and how far she wanders into the way (0 = parked at an edge). */
  mischief: number;
  /** Liquid island calibration: offsets from the sample's anchor geometry. */
  island: Calibration;
};

export const MASCOT_SETTINGS_KEY = "mascot:settings";
/** Relative, no "..", no leading "/", no backslash. */
export const isSafeSpriteDir = (d: string) => !d.split("/").includes("..") && !d.startsWith("/") && !d.includes("\\");
const SLIDER_IDS = ["brat", "bimbo", "hypnosis", "heat", "length"] as const;

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
  voice: PERSONAS.find((p) => p.id === "miyabi")!.voice, selfName: "Miyabi", heatDrift: false, spriteDir: "", empty: false, shelf: false, vials: [], mischief: 5, island: CAL_ZERO,
  sliders: { brat: { value: 6, cap: 10 }, bimbo: { value: 0, cap: 10 }, hypnosis: { value: 0, cap: 10 }, heat: { value: 0, cap: 10 }, length: { value: 4, cap: 10 } },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const tags = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TAGS;
const int = (v: unknown, hi: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= hi;
const hour = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23;

/** Untrusted client settings patch: `empty` belongs to insert/remove, `vials` to the vials API and `live` drift to the server, so all are dropped (moving a slider resets drift). */
export function clientSettingsPatch(patch: unknown): unknown {
  if (!isObj(patch)) return patch;
  const { empty: _empty, vials: _vials, ...rest } = patch;
  if (isObj(rest.sliders)) rest.sliders = Object.fromEntries(Object.entries(rest.sliders).map(([k, v]) => [k, isObj(v) ? { value: v.value, cap: v.cap } : v]));
  return rest;
}

/** Apply valid fields of an untrusted patch onto cur; invalid fields are ignored. */
export function mergeMascotSettings(cur: MascotSettings, patch: unknown): MascotSettings {
  if (!isObj(patch)) return cur;
  const out: MascotSettings = { ...cur, mods: { ...cur.mods }, layerTags: { ...cur.layerTags }, exprTags: { ...cur.exprTags }, sliders: { ...cur.sliders } };
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
  if (typeof patch.voice === "string" && patch.voice.length <= 1500) out.voice = patch.voice;
  if (typeof patch.selfName === "string" && patch.selfName.length <= 40) out.selfName = patch.selfName;
  if (typeof patch.heatDrift === "boolean") out.heatDrift = patch.heatDrift;
  if (typeof patch.empty === "boolean") out.empty = patch.empty;
  if (typeof patch.shelf === "boolean") out.shelf = patch.shelf;
  if (int(patch.mischief, 10)) out.mischief = patch.mischief;
  out.island = mergeCalibration(cur.island, patch.island);
  if (typeof patch.spriteDir === "string" && patch.spriteDir.length <= 200 && isSafeSpriteDir(patch.spriteDir)) out.spriteDir = patch.spriteDir;
  if (Array.isArray(patch.vials) && patch.vials.length <= 8) {
    const vials = patch.vials.map(validateAppliedVial);
    if (vials.every(Boolean)) out.vials = vials as AppliedVial[];
  }
  if (isObj(patch.sliders)) for (const k of SLIDER_IDS) {
    const x = patch.sliders[k];
    if (isObj(x) && int(x.value, 10) && int(x.cap, 10) && x.cap >= x.value) out.sliders[k] = int(x.live, x.cap) ? { value: x.value, cap: x.cap, live: x.live } : { value: x.value, cap: x.cap };
  }
  return out;
}

export function parseMascotSettings(json: string | null): MascotSettings {
  if (!json) return DEFAULT_MASCOT_SETTINGS;
  try {
    const raw = JSON.parse(json);
    const out = mergeMascotSettings(DEFAULT_MASCOT_SETTINGS, raw);
    // First run (no sliders saved yet): brat follows the old bratty toggle.
    if (!isObj(raw) || !isObj(raw.sliders)) out.sliders.brat = { ...out.sliders.brat, value: out.mods.bratty ? 6 : 0 };
    return out;
  } catch { return DEFAULT_MASCOT_SETTINGS; }
}
