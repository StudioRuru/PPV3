import type { MascotEvent } from "./core";

/** Tell the floating mascot something happened. No-op on the server. */
export function emitMascot(kind: MascotEvent["kind"], data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MascotEvent>("mascot", { detail: { kind, at: Date.now(), data } }));
}
