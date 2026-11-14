import type { RpMessage } from "./types";

/** Text mode replies as a burst of short texts: split the model's raw reply, pull out a reaction, tag ensemble speakers. */
export type Bubble = { text: string; speaker: string; photo?: string };
export type Burst = { bubbles: Bubble[]; reaction: string };

const MAX = 5;
const PHOTO = /^\[photo:\s*([^\]]+?)\s*\]$/i;
const REACT = /^\s*\[react:\s*([^\]\s]{1,16})\s*\]\s*/;
const EMOJI = /^[\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]{1,8}$/u;
const SPLITS: [RegExp, string][] = [[/^\s*-{3,}\s*$/m, "\n"], [/\n\s*\n/, "\n\n"], [/\n/, "\n"], [/(?<=[.!?…])\s+/, " "]];

export function splitBurst(raw: string, cast: string[]): Burst {
  const text = raw.trim();
  let reaction = "";
  let parts = [text];
  for (const [re, join] of SPLITS) {
    const p = text.split(re).map((s) => s.trim()).filter(Boolean);
    if (p.length > 1) { parts = p.length > MAX ? [...p.slice(0, MAX - 1), p.slice(MAX - 1).join(join)] : p; break; }
  }
  const names = new Map(cast.map((c) => [c.toLowerCase(), c]));
  // The reaction tag may open any bubble (models often put it second); the first one wins, all are stripped.
  parts = parts.map((t) => {
    const r = t.match(REACT);
    if (!r || [...r[1]].length > 8 || !EMOJI.test(r[1])) return t;
    reaction ||= r[1];
    return t.slice(r[0].length);
  });
  const bubbles = parts.filter(Boolean).map((t) => {
    const m = t.match(/^([^:\n]{1,40}):\s*/);
    const who = m && names.get(m[1].trim().toLowerCase());
    const b = who ? { text: t.slice(m[0].length), speaker: who } : { text: t, speaker: "" };
    const ph = b.text.match(PHOTO);
    return ph ? { ...b, text: "", photo: ph[1] } : b;
  });
  return { bubbles: bubbles.length ? bubbles : [{ text: "", speaker: "" }], reaction };
}

/** A bubble's row content: a photo is kept as its tag so the model sees it in history. */
export const bubbleContent = (x: Bubble) => (x.photo ? `[photo: ${x.photo}]` : x.text);
/** The burst as the model wrote it, for history and drafts. */
export const burstText = (b: Burst) => b.bubbles.map((x) => (x.speaker ? `${x.speaker}: ` : "") + bubbleContent(x)).join("\n---\n");

export const typingMs = (text: string) => Math.min(3000, Math.max(600, 40 * text.length));

/** History as the model sees it: each burst's rows become one reply (head id, takes as swipes). Legacy rows pass through. */
export function joinBursts(ms: RpMessage[]): RpMessage[] {
  const out: RpMessage[] = [];
  for (const m of ms) {
    const prev = out.at(-1);
    if (m.burstId && prev?.burstId === m.burstId) { out[out.length - 1] = { ...prev, content: `${prev.content}\n---\n${m.speaker ? `${m.speaker}: ` : ""}${m.content}` }; continue; }
    out.push(m.burstId ? { ...m, content: m.speaker ? `${m.speaker}: ${m.content}` : m.content, swipes: (m.burstSwipes ?? []).map(burstText) } : m);
  }
  return out;
}
