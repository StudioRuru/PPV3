import type { RpStore } from "./store";
import type { ChatMessage, RpCharacter, RpChat, RpSettings } from "./types";

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

export type Mode = "text" | "rp";

/** Per-chat Tune > hand-set character agency > profile default > global. Replaced, never blended. */
export function resolveAgency(chat: Pick<RpChat, "replyAgency">, c: Pick<RpCharacter, "agency"> | null, p: RpProfile | null, s: RpSettings): number {
  return chat.replyAgency ?? c?.agency ?? p?.defaults.agency ?? s.replyAgency;
}
/** Per-chat Tune > global, clamped to the profile's spice range. */
export function resolveSpice(chat: Pick<RpChat, "replySpice">, p: RpProfile | null, s: RpSettings): number {
  const v = chat.replySpice ?? s.replySpice, r = p?.defaults.spice;
  return r ? Math.max(r.min, Math.min(r.max, v)) : v;
}

/** `n` items of `a`, starting at a turn-based offset so each turn shows a different (but reproducible) slice. */
const rot = <T,>(a: T[], turn: number, n: number, k = 1): T[] => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[(turn * k + i) % a.length]));

/**
 * The profile lines that ride with the post-history voice reminder (~150–250 tokens). Always: who's who, format,
 * hard limits, register + a tic. Rotating per turn: 2 traits, a want or fear, and (RP) a hook / (Text) sample lines.
 */
export function profileSlice(p: RpProfile, mode: Mode, turn: number): string {
  const lines: string[] = [];
  const who = p.cast.length > 1 ? p.cast.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join(", ") : "";
  if (who) lines.push(`Cast: ${who} — keep each one's own voice.`);
  if (p.format) lines.push(`Output format: ${p.format}`);
  if (p.wouldNever.length) lines.push(`Would never: ${p.wouldNever.slice(0, 5).join("; ")}.`);
  const tics = rot(p.speech.tics, turn, mode === "text" ? 2 : 1, 2);
  if (p.speech.register || tics.length) lines.push(`Speech: ${[p.speech.register, tics.length ? `tics: ${tics.map((t) => `"${t}"`).join(", ")}` : ""].filter(Boolean).join(" — ")}.`);
  const traits = rot(p.coreTraits, turn, 2, 2);
  if (traits.length) lines.push(`Lean into: ${traits.join(", ")}.`);
  const drives = [...p.wants.map((w) => `wants ${w}`), ...p.fears.map((f) => `fears ${f}`)];
  if (drives.length) lines.push(`Under the surface: ${rot(drives, turn, 1)[0]}.`);
  if (mode === "text") {
    const sample = rot(p.speech.sampleLines, turn, 2);
    if (sample.length) lines.push(`Sounds like: ${sample.map((l) => `"${l}"`).join(" / ")}`);
  } else {
    const hook = rot(p.hooks, turn, 1)[0];
    if (hook) lines.push(`Thread to pull on: ${hook}. Show it through body language, not exposition.`);
  }
  return lines.map((l) => (l.length > 240 ? `${l.slice(0, 239)}…` : l)).join("\n");
}

/* ------------------------------ extraction ------------------------------ */

export const PROFILE_SYSTEM = `You distill a roleplay character card (and its avatar, if attached) into a JSON profile.
Speak in the card's own terms only and invent nothing: leave a field empty ("" or []) when the card doesn't say.
Output ONLY one JSON object with these keys:
displayName (the name the character is called in conversation, not the card title),
cast ([{name, role, appearanceTags}] — one entry per distinct speaker the card voices; a single-character card has one),
coreTraits [], speech {register, tics [], sampleLines [] (short lines in their voice, quoted from or closely following the card)},
format (the literal output-format convention the card uses, e.g. thought headers or bracketed status lines — copied exactly),
wants [], fears [], knows [], doesntKnow [], viewOfUser, wouldNever [], hooks [] (unresolved threads the story can pull on),
relationships [], defaults {agency 0-4, spice {min,max} 0-4, mode "text"|"rp"} (only when the card clearly implies them),
appearanceTags (comma-separated Danbooru-style tags for how they look), conflicts [] (mods or behaviours the card forbids).`;

const cardText = (c: RpCharacter) => [
  ["Card title", c.name], ["Description", c.description], ["Personality", c.personality], ["Scenario", c.scenario],
  ["First message", c.firstMessage], ["Example dialogue", c.exampleDialogue],
].filter(([, v]) => v?.trim()).map(([k, v]) => `## ${k}\n${v.trim()}`).join("\n\n");

export function profileRequest(c: RpCharacter, avatarB64?: string): { system: string; messages: ChatMessage[] } {
  return {
    system: PROFILE_SYSTEM,
    messages: [{ role: "user", content: `${cardText(c)}\n\nWrite the JSON profile.`, ...(avatarB64 ? { images: [avatarB64] } : {}) }],
  };
}

/** Ask the model for a profile; null when the reply has no usable JSON. Never marks it edited — that's the owner's. */
export async function extractProfile(c: RpCharacter, avatar: Buffer | null, ask: (system: string, messages: ChatMessage[]) => Promise<string>): Promise<RpProfile | null> {
  const r = profileRequest(c, avatar?.toString("base64"));
  const out = await ask(r.system, r.messages);
  const a = out.indexOf("{"), b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const p = parseProfile(out.slice(a, b + 1));
  if (p) delete p.edited;
  return p;
}

type Ask = (system: string, messages: ChatMessage[]) => Promise<string>;

/** Import-time extraction: best effort, a failure only logs and leaves `profile` null. */
export async function refreshProfile(store: RpStore, id: number, avatar: Buffer | null, ask: Ask): Promise<void> {
  const c = store.character(id);
  if (!c) return;
  try {
    const p = await extractProfile(c, avatar, ask);
    if (p) store.saveCharacter({ id, name: c.name, profile: JSON.stringify(p) });
  } catch (e) {
    console.warn(`[rp] profile extraction failed for character ${id}: ${(e as Error).message}`);
  }
}

/** The sheet's Rebuild: refuses to overwrite a hand-edited profile unless `force`. */
export async function rebuildProfile(store: RpStore, id: number, avatar: Buffer | null, ask: Ask, force: boolean): Promise<{ status: number; body: unknown }> {
  const c = store.character(id);
  if (!c) return { status: 404, body: { error: "Not found" } };
  if (!force && parseProfile(c.profile)?.edited) return { status: 409, body: { error: "edited" } };
  const p = await extractProfile(c, avatar, ask);
  if (!p) return { status: 502, body: { error: "The model didn't return a usable profile — try again." } };
  store.saveCharacter({ id, name: c.name, profile: JSON.stringify(p) });
  return { status: 200, body: { character: store.character(id) } };
}

/** Photo appearance: the hand-written card prompt wins; extracted tags (per speaker for ensembles) only fill a blank. */
export function photoAppearance(c: Pick<RpCharacter, "appearancePrompt">, p: RpProfile | null, speaker?: string): string {
  if (c.appearancePrompt?.trim()) return c.appearancePrompt.trim();
  const member = speaker ? p?.cast.find((m) => m.name.toLowerCase() === speaker.toLowerCase()) : undefined;
  return member?.appearanceTags || p?.appearanceTags || "";
}

export const parseLearned = (raw: string | null | undefined): string[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
};

/** A profile saved by hand from the sheet: flagged `edited` so Rebuild won't silently overwrite it; null when unparseable. */
export function markEdited(raw: string): string | null {
  const p = parseProfile(raw);
  return p ? JSON.stringify({ ...p, edited: true }) : null;
}
