// Imported by client components: type-only imports from server modules.
import type { EngineView, StepId } from "./engine";

/** Hyperstack flavor ("n3-L40x1", "n3-RTX-A6000x1") → short GPU name ("L40", "A6000"). */
export function gpuName(flavor: string | null): string {
  return flavor?.match(/^[^-]+-(?:RTX-)?(.+?)(?:x\d+)?$/)?.[1] ?? "GPU";
}

export function gpuLabel(v: EngineView, now: number): string {
  const g = gpuName(v.gpu);
  switch (v.phase) {
    case "starting":
    case "warming": return `● ${g} warming…${v.since ? ` ${Math.max(0, Math.round((now - v.since) / 1000))}s` : ""}`;
    case "ready": return `● ${g} ready · $${v.runCost.toFixed(2)}`;
    case "stopping": return `○ ${g} stopping…`;
    case "unavailable": return `● ${g} unavailable`;
    default: return v.kept ? "○ GPU off · models kept" : "○ GPU off";
  }
}

export const alarmText = (v: EngineView): string | null => v.alarm || null;

/** Plain-words step failure for the checklist: no secrets, at most 120 characters. */
export function stepError(step: StepId, raw: string): string {
  const r = raw.replace(/(Bearer\s+|token[=:]\s*|key[=:]\s*)\S+/gi, "$1***").replace(/\b(hf|civitai)_\w+/gi, "***");
  const failed = /FAILED (\S+)/.exec(r)?.[1];
  const msg = /RESERVED/.test(r) ? "The models volume is RESERVED by another VM — contact Hyperstack, then retry."
    : /Could not resolve hostname|port 22|SSH never answered|Connection (timed out|refused|reset)/i.test(r) ? "Can't reach the pod over the tailnet — check Tailscale, then retry."
    : failed ? `Download failed: ${failed} — check its link, then retry.`
    : /link is dead/.test(r) ? r
    : `${step} step failed: ${r.split("\n").find((l) => l.trim())?.trim() ?? "unknown error"}`;
  return msg.slice(0, 120);
}
