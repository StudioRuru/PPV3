import type { Expression } from "./mascot/core";
import { TABS, TAB_IDS, type Tab } from "./tabs";

/** Web → iOS shell (Live Activity) state, posted as `{ activity: ActivityState }`. */
export type ActivityState = { tab: Tab; tabLabel: string; expression: Expression; hidden: boolean; bust: string | null; on: boolean };
export type Intent = { tab: Tab } | { mascot: "hide" | "summon" };

const PREFIX = "/api/mascot/sprites/";
const safeBust = (b: unknown): string | null =>
  typeof b === "string" && b.startsWith(PREFIX) && b.length <= 300 && !b.includes("..") ? b : null;

export function activityState(i: { tab: Tab; tabLabel?: string; expression: Expression; hidden: boolean; bust: string | null; on: boolean }): ActivityState {
  const label = i.tabLabel ?? TABS.find((t) => t.id === i.tab)?.label ?? "Studio";
  return { tab: i.tab, tabLabel: label.slice(0, 24), expression: i.expression, hidden: i.hidden, bust: safeBust(i.bust), on: i.on };
}

export const changed = (a: ActivityState | null, b: ActivityState) =>
  !a || (Object.keys(b) as (keyof ActivityState)[]).some((k) => a[k] !== b[k]);

/** Change-only, at most one send per `ms`; a change inside the window is sent (latest wins) when it ends. */
export function makeThrottle(post: (s: ActivityState) => void, ms = 2000, now: () => number = Date.now, later: (f: () => void, ms: number) => unknown = setTimeout) {
  let sent: ActivityState | null = null, last = -Infinity, pending: ActivityState | null = null, armed = false;
  const flush = () => {
    armed = false;
    const p = pending; pending = null;
    if (p && changed(sent, p)) { sent = p; last = now(); post(p); }
  };
  return (s: ActivityState) => {
    pending = s;
    if (!changed(sent, s)) return;
    const wait = last + ms - now();
    if (wait <= 0) flush();
    else if (!armed) { armed = true; later(flush, wait); }
  };
}

/** Untrusted native → web intent: exactly one known key with a whitelisted value. */
export function parseIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1) return null;
  const v = (raw as Record<string, unknown>)[keys[0]];
  if (keys[0] === "tab" && TAB_IDS.includes(v as Tab)) return { tab: v as Tab };
  if (keys[0] === "mascot" && (v === "hide" || v === "summon")) return { mascot: v };
  return null;
}

type Bridge = { webkit?: { messageHandlers?: { studio?: { postMessage: (m: unknown) => void } } } };
export function postActivity(activity: ActivityState) {
  if (typeof window === "undefined") return;
  (window as unknown as Bridge).webkit?.messageHandlers?.studio?.postMessage({ activity });
}
