import type { MascotEvent } from "./core";
import type { ReactEvent } from "./play";

/** Tell the floating mascot something happened. No-op on the server. */
export function emitMascot(kind: MascotEvent["kind"], data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MascotEvent>("mascot", { detail: { kind, at: Date.now(), data } }));
}

/** Ask a character's sprite for a reaction clip (`mascot:react` {profile, event}); a quip, if any, travels separately. */
export function emitReact(profile: "miyabi" | "aru", event: ReactEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mascot:react", { detail: { profile, event } }));
}
