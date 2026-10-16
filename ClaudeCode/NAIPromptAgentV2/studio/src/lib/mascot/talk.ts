// Waist-up "talk portrait" frames (Plan 20). Pure data + fallback; request/path builders live in sprites.ts.
import { EXPRESSIONS, type Expression } from "./core";

export const TALK_FRAMES = [...EXPRESSIONS, "think1", "think2", "talk_open", "talk_closed", "listen"] as const;
export type TalkFrame = (typeof TALK_FRAMES)[number];

export const TALK = "upper body, cowboy shot, looking at viewer, simple background, white background";
export const TALK_UC = "full body, legs, thighs, feet, shoes, wide shot";
/** Non-expression frames get their own small tag set instead of the expression tags. */
export const TALK_FRAME_TAGS: Record<Exclude<TalkFrame, Expression>, string> = {
  think1: "thinking, looking up, hand on own chin",
  think2: "thinking, looking up, hand on own chin",
  talk_open: "open mouth, talking",
  talk_closed: "closed mouth",
  listen: "head tilt, attentive, slight smile",
};

/** Listing key: `talk/<outfit>/<name>`. */
export const talkKey = (outfit: string, frame: string): string => `talk/${outfit}/${frame}`;

/** Portrait part of the fallback chain: frame → outfit smug → day frame → day smug; null → caller falls back to the bust/placeholder. */
export function pickTalkFrame(have: Set<string>, outfit: string, frame: string): string | null {
  return [talkKey(outfit, frame), talkKey(outfit, "smug"), talkKey("day", frame), talkKey("day", "smug")].find((k) => have.has(k)) ?? null;
}

export const TALK_TICK_MS = 280;
export const THINK_TICK_MS = 700;

/** listen = the user is typing (UI sets it directly); send → think; first streamed token → talk; end → done; error → idle. */
export type TalkPhase = "idle" | "listen" | "think" | "talk" | "done" | "empty";
export type TalkEvent = "send" | "firstToken" | "end" | "error" | "reset";

export function nextPhase(phase: TalkPhase, ev: TalkEvent): TalkPhase {
  if (phase === "empty") return "empty";
  if (ev === "send") return "think";
  if (ev === "firstToken") return phase === "think" ? "talk" : phase;
  if (ev === "end") return "done";
  return "idle"; // error, reset
}

export function talkFrame(phase: TalkPhase, tick: number, expression: Expression): TalkFrame {
  const odd = tick % 2 === 1;
  if (phase === "listen") return "listen";
  if (phase === "think") return odd ? "think2" : "think1";
  if (phase === "talk") return odd ? "talk_closed" : "talk_open";
  return phase === "empty" ? "smug" : expression;
}

const TAG = /\s*\[([a-z]+)\]\s*$/i;

/** Miyabi's reply ends with one `[expression]`: strip it and return it (unknown or missing → smug, text unchanged). */
export function splitExpressionTag(text: string): { text: string; expression: Expression } {
  const m = TAG.exec(text);
  const w = m?.[1].toLowerCase() as Expression | undefined;
  return m && w && EXPRESSIONS.includes(w) ? { text: text.slice(0, m.index), expression: w } : { text, expression: "smug" };
}

/** Streaming view: hide a trailing partial or complete `[word` / `[word]` so the tag never flashes. */
export const visibleWhileStreaming = (text: string): string => text.replace(/\[[a-z]*\]?\s*$/i, "");
