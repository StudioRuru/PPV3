import "server-only";
import { db, getSetting, setSetting } from "./db";
import { nextDrift, type PersonaId } from "./persona";
import { profile, tasteBlock, type TasteEvent } from "./taste";

/** Per-persona boldness, 0–100 (Settings / persona sheet slider; nudged by reactions). */
export const getDrift = (p: PersonaId) => Number(getSetting(`drift:${p}`)) || 0;
export const setDrift = (p: PersonaId, d: number) => setSetting(`drift:${p}`, String(Math.min(100, Math.max(0, Math.round(d)))));

export function recordEvent(kind: TasteEvent["kind"], tags: string[], note: string, persona: PersonaId): void {
  db.prepare("INSERT INTO taste_events (created_at, kind, tags, note, persona) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), kind, JSON.stringify(tags.slice(0, 200)), note.slice(0, 500), persona);
  setDrift(persona, nextDrift(getDrift(persona), kind));
}

// ponytail: profile recomputed from the last 500 events per prompt — fine at personal scale; cache if it grows.
export function currentProfile() {
  const rows = db.prepare("SELECT kind, tags, note, created_at FROM taste_events ORDER BY id DESC LIMIT 500").all() as { kind: TasteEvent["kind"]; tags: string; note: string; created_at: number }[];
  return profile(rows.reverse().map((r) => ({ ...r, tags: JSON.parse(r.tags) })));
}

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
