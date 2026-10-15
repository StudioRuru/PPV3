import "server-only";
import { db, getSetting, setSetting } from "./db";
import { nextDrift, type PersonaId } from "./persona";
import { profile, storyBlock, tasteBlock, type TasteEvent } from "./taste";

/** Per-persona boldness, 0–100 (Settings / persona sheet slider; nudged by reactions). */
export const getDrift = (p: PersonaId) => Number(getSetting(`drift:${p}`)) || 0;
export const setDrift = (p: PersonaId, d: number) => setSetting(`drift:${p}`, String(Math.min(100, Math.max(0, Math.round(d)))));

/** RP feedback (`source: "rp"`) teaches stories, not tags, and doesn't move a co-pilot persona's boldness. */
export function recordEvent(kind: TasteEvent["kind"], tags: string[], note: string, persona: PersonaId, source: "tag" | "rp" = "tag"): void {
  db.prepare("INSERT INTO taste_events (created_at, kind, tags, note, persona, source) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Date.now(), kind, JSON.stringify(tags.slice(0, 200)), note.slice(0, 500), persona, source);
  if (source === "tag") setDrift(persona, nextDrift(getDrift(persona), kind));
}

// ponytail: profile recomputed from the last 500 events per prompt — fine at personal scale; cache if it grows.
const events = (source: "tag" | "rp"): TasteEvent[] =>
  (db.prepare("SELECT kind, tags, note, created_at, source FROM taste_events WHERE source = ? ORDER BY id DESC LIMIT 500").all(source) as (Omit<TasteEvent, "tags"> & { tags: string })[])
    .reverse().map((r) => ({ ...r, tags: JSON.parse(r.tags) }));

export const currentProfile = () => profile(events("tag"));
/** "How the owner likes stories", for the companion and RP prompts. */
export const learnedStoryBlock = () => storyBlock(events("rp"));

export const pinned = () => db.prepare("SELECT id, text FROM pinned_prefs ORDER BY id").all() as { id: number; text: string }[];
export const pin = (text: string) => db.prepare("INSERT INTO pinned_prefs (text) VALUES (?)").run(text.trim().slice(0, 200));
export const unpin = (id: number) => db.prepare("DELETE FROM pinned_prefs WHERE id = ?").run(id);

// Newest pinned rules win when there are more than the prompt holds.
export const learnedBlock = () => tasteBlock(currentProfile(), pinned().slice(-10).map((p) => p.text));

/** Forget everything learned (events + drift); pinned rules are kept unless asked. */
export function resetLearning(alsoPinned = false): void {
  db.exec("DELETE FROM taste_events");
  db.exec("DELETE FROM settings WHERE key LIKE 'drift:%'");
  if (alsoPinned) db.exec("DELETE FROM pinned_prefs");
}
