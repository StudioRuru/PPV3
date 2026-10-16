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
