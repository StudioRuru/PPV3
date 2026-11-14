import type { RpCharacter } from "./types";

// A character profile distilled from the card (and avatar) once at import, editable on the sheet.
export type CastMember = { name: string; role: string; appearanceTags?: string };
export type RpProfile = {
  displayName: string; cast: CastMember[]; coreTraits: string[];
  speech: { register: string; tics: string[]; sampleLines: string[] };
  format: string; wants: string[]; fears: string[]; knows: string[]; doesntKnow: string[];
  viewOfUser: string; wouldNever: string[]; hooks: string[]; relationships: string[];
  defaults: { agency?: number; spice?: { min: number; max: number }; mode?: "text" | "rp" };
  appearanceTags: string; conflicts: string[]; edited?: boolean;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const level = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(4, Math.round(v))) : undefined);

/** Any JSON (or JSON string) → a complete profile with empty values for missing fields; null when nothing usable. */
export function parseProfile(raw: unknown): RpProfile | null {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
  const o = obj(raw);
  const sp = obj(o.speech), d = obj(o.defaults), spice = obj(d.spice);
  const p: RpProfile = {
    displayName: str(o.displayName),
    cast: (Array.isArray(o.cast) ? o.cast : []).map(obj).filter((c) => str(c.name))
      .map((c) => ({ name: str(c.name), role: str(c.role), ...(str(c.appearanceTags) ? { appearanceTags: str(c.appearanceTags) } : {}) })),
    coreTraits: list(o.coreTraits),
    speech: { register: str(sp.register), tics: list(sp.tics), sampleLines: list(sp.sampleLines) },
    format: str(o.format), wants: list(o.wants), fears: list(o.fears), knows: list(o.knows), doesntKnow: list(o.doesntKnow),
    viewOfUser: str(o.viewOfUser), wouldNever: list(o.wouldNever), hooks: list(o.hooks), relationships: list(o.relationships),
    defaults: {}, appearanceTags: str(o.appearanceTags), conflicts: list(o.conflicts),
    ...(o.edited === true ? { edited: true } : {}),
  };
  const agency = level(d.agency), lo = level(spice.min), hi = level(spice.max);
  if (agency !== undefined) p.defaults.agency = agency;
  if (lo !== undefined && hi !== undefined) p.defaults.spice = { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  if (d.mode === "text" || d.mode === "rp") p.defaults.mode = d.mode;
  const usable = p.displayName || p.cast.length || p.coreTraits.length || p.speech.register || p.format || p.wants.length || p.hooks.length || p.wouldNever.length;
  return usable ? p : null;
}

/** The name prompts and headers use; the card title is only a list label. */
export const charName = (c: Pick<RpCharacter, "name" | "displayName">) => c.displayName?.trim() || c.name;
