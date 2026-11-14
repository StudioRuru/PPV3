// Hidden in-character planning: a short first-person intent, collected before the reply and fed back as a private note.
import { foldSystem, type Turn } from "./turn";
import type { Mode, RpChat, RpSettings } from "./types";

export const THINK_TAG = "[Your private intent — act on it, don't repeat it]";

const plan = (name: string) =>
  `[Before replying, think as ${name} in 3–5 short first-person lines: what I notice, what I want right now, what I'll do, and what I won't say. Write only those lines — no reply, no narration.]`;

/** The planning call: same model and history, a short cap, slightly cooler. */
export function thinkRequest(turn: Turn, charName: string): Turn {
  const temperature = Math.max(0.5, (turn.options.temperature ?? 0.8) - 0.2);
  return foldSystem({ ...turn, options: { ...turn.options, num_predict: 200, temperature }, messages: [...turn.messages, { role: "system", content: plan(charName) }] });
}

/** Puts the thought just before the final user turn's text, keeping the single system block. */
export function withThought(turn: Turn, thought: string): Turn {
  const ms = [...turn.messages];
  const i = ms.findLastIndex((m) => m.role === "user");
  if (i < 0 || !thought.trim()) return turn;
  ms.splice(i, 0, { role: "system", content: `${THINK_TAG}\n${thought.trim()}` });
  return foldSystem({ ...turn, messages: ms });
}

/** Drops a leaked tag line or a reply that opens by repeating the thought's first line. */
export function stripThoughtEcho(reply: string, thought: string): string {
  let out = reply.trimStart();
  if (out.startsWith(THINK_TAG)) out = out.slice(THINK_TAG.length).trimStart();
  const first = thought.trim().split("\n")[0]?.trim();
  if (first && out.startsWith(first)) out = out.slice(first.length).trimStart();
  return out;
}

export const thinkOn = (chat: Pick<RpChat, "think">, mode: Mode, settings: RpSettings): boolean =>
  chat.think != null ? chat.think === 1 : settings.thinkByMode?.[mode] === true;
