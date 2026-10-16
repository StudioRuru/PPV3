// Character profiles for the sprite studio / portraits: Miyabi (the active slime look) and Aru (her own tags + sprite folder).
import { EXPRESSIONS, OUTFITS, type Expression, type Outfit } from "./core";
import type { MascotSettings } from "./settings";

export const PROFILES = ["miyabi", "aru"] as const;
export type Profile = (typeof PROFILES)[number];
export const isProfile = (p: unknown): p is Profile => PROFILES.includes(p as Profile);

export const ARU_SETTINGS_KEY = "mascot:aru";
const MAX_TAGS = 1500;
export type AruSettings = { charTags: string; constantTags: string; layerTags: { day: string }; exprTags: Record<Expression, string> };

/** From the owner's description; editable in the studio. */
export const ARU_DEFAULT_TAGS: AruSettings = {
  charTags: "1girl, solo, cat girl, cat ears, cat tail, neck bell, collar, blue leash, gold earrings, ear tag, droopy eyes, large breasts",
  constantTags: "holding ladle, huge ladle",
  layerTags: { day: "revealing clothes" },
  exprTags: {
    smug: "smug, smirk, half-closed eyes",
    laughing: "laughing, open mouth, closed eyes",
    wink: "one eye closed, tongue out",
    pout: "pout, puffed cheeks",
    flirty: "seductive smile, blush, half-closed eyes",
    shocked: "surprised, wide-eyed, open mouth, sweat",
    annoyed: "annoyed, frown, glaring",
    excited: "excited, open smile, sparkling eyes",
    sleepy: "sleepy, half-closed eyes, yawning",
  },
};

const tags = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TAGS;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Apply valid fields of an untrusted patch onto cur; invalid fields are ignored. */
export function mergeAruSettings(cur: AruSettings, patch: unknown): AruSettings {
  if (!isObj(patch)) return cur;
  const out: AruSettings = { ...cur, layerTags: { ...cur.layerTags }, exprTags: { ...cur.exprTags } };
  if (tags(patch.charTags)) out.charTags = patch.charTags;
  if (tags(patch.constantTags)) out.constantTags = patch.constantTags;
  if (isObj(patch.layerTags) && tags(patch.layerTags.day)) out.layerTags.day = patch.layerTags.day;
  if (isObj(patch.exprTags)) for (const k of EXPRESSIONS) if (tags(patch.exprTags[k])) out.exprTags[k] = patch.exprTags[k];
  return out;
}

export function parseAruSettings(json: string | null): AruSettings {
  if (!json) return ARU_DEFAULT_TAGS;
  try { return mergeAruSettings(ARU_DEFAULT_TAGS, JSON.parse(json)); } catch { return ARU_DEFAULT_TAGS; }
}

export type ProfileLook = { charTags: string; constantTags: string; layerTags: Record<Outfit, string>; exprTags: Record<Expression, string>; spriteDir: string; outfits: Outfit[] };

/** The tags + sprite folder + outfits a profile draws with. Miyabi = today's active look; Aru = her own (day only). */
export function profileLook(profile: Profile, s: MascotSettings, aru: AruSettings): ProfileLook {
  if (profile === "miyabi") return { charTags: s.charTags, constantTags: s.constantTags, layerTags: s.layerTags, exprTags: s.exprTags, spriteDir: s.spriteDir, outfits: [...OUTFITS] };
  return { ...aru, layerTags: { day: aru.layerTags.day, night: "", lewd: "" }, spriteDir: "aru", outfits: ["day"] };
}
