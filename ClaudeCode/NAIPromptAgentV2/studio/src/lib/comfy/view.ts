// Imported by client components: type-only imports from server modules.
import type { EngineView } from "./engine";

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
