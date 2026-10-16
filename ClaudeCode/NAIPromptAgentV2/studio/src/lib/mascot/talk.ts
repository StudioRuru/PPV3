// Waist-up "talk portrait" frames (Plan 20). Pure data + fallback; request/path builders live in sprites.ts.
import { EXPRESSIONS, pickSprite, type Expression, type Outfit } from "./core";

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
const WARN = "\n\n⚠️";

/** Miyabi's reply ends with one `[expression]`: strip all trailing ones (a trailing ⚠️ warning block is kept after the text) and return the last; none → smug, text unchanged. */
export function splitExpressionTag(text: string): { text: string; expression: Expression } {
  const w = text.lastIndexOf(WARN); // the server's warning is always last; a model-written ⚠️ paragraph stays in the body
  const head = w < 0 ? text : text.slice(0, w), warn = w < 0 ? "" : text.slice(w);
  let body = head, expression: Expression | null = null;
  for (let m = TAG.exec(body); m && EXPRESSIONS.includes(m[1].toLowerCase() as Expression); m = TAG.exec(body)) {
    expression ??= m[1].toLowerCase() as Expression;
    body = body.slice(0, m.index);
  }
  return expression ? { text: body + warn, expression } : { text, expression: "smug" };
}

/** Streaming view: hide a trailing `[` + prefix of an expression name (or a complete `[expression]`) so the tag never flashes. */
export function visibleWhileStreaming(text: string): string {
  const m = /\[([a-z]*)(\]?)\s*$/i.exec(text);
  if (!m) return text;
  const w = m[1].toLowerCase();
  return EXPRESSIONS.some((e) => (m[2] ? e === w : e.startsWith(w))) ? text.slice(0, m.index) : text;
}

/** Composer focus: listen while typing unless a reply is in flight; leaving the field drops listen. */
export function listenPhase(phase: TalkPhase, focused: boolean): TalkPhase {
  if (focused) return phase === "idle" || phase === "done" ? "listen" : phase;
  return phase === "listen" ? "idle" : phase;
}

/** Portrait key: talk chain → bust (expression frames keep their expression, others smug) → null (placeholder). bob = a motion frame stood in by a still. */
export function portraitPick(have: Set<string>, outfit: string, frame: TalkFrame): { key: string | null; bob: boolean } {
  const expr = (EXPRESSIONS as readonly string[]).includes(frame) ? (frame as Expression) : null;
  const key = pickTalkFrame(have, outfit, frame) ?? pickSprite(have, outfit as Outfit, expr ?? "smug");
  return { key, bob: !expr && key !== talkKey(outfit, frame) };
}
