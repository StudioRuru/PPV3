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
  let sent: ActivityState | null = null, last = -Infinity, pending: ActivityState | null = null, armed = false, dead = false;
  const flush = () => {
    armed = false;
    const p = pending; pending = null;
    if (dead) return;
    if (p && changed(sent, p)) { sent = p; last = now(); post(p); }
  };
  const send = (s: ActivityState) => {
    pending = s;
    if (dead || !changed(sent, s)) return;
    const wait = last + ms - now();
    if (wait <= 0) flush();
    else if (!armed) { armed = true; later(flush, wait); }
  };
  send.flush = flush; // send any pending change now (page going to background)
  send.cancel = () => { dead = true; pending = null; };
  return send;
}

/** Holds the latest state until the page knows the real one (Mascot settings loaded); then forwards every push. */
export function makeGate(send: (s: ActivityState) => void) {
  let latest: ActivityState | null = null, known = false;
  return {
    push(s: ActivityState) { latest = s; if (known) send(s); },
    ready() { known = true; if (latest) send(latest); },
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

/** Web → iOS haptic tap, posted as `{ haptic }`. No-op outside the app. */
export type Haptic = "light" | "medium" | "success" | "error" | "selection";
const HAPTICS: readonly unknown[] = ["light", "medium", "success", "error", "selection"];
export const isHaptic = (v: unknown): v is Haptic => HAPTICS.includes(v);
export function postHaptic(haptic: Haptic) {
  if (typeof window === "undefined") return;
  (window as unknown as Bridge).webkit?.messageHandlers?.studio?.postMessage({ haptic });
}
