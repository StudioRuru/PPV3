import { parseScene, type SceneOut } from "./scene";

/** The scene route streams prose, then "\n\u0000" + JSON {out, dropped}; error replies may have no NUL part. */
export function splitSceneStream(raw: string): { prose: string; out: SceneOut | null; dropped: string[] } {
  const i = raw.indexOf("\u0000");
  if (i < 0) return { prose: raw.trim(), out: null, dropped: [] };
  const prose = parseScene(raw.slice(0, i)).prose.trim(); // same fence strip the route persists
  try {
    const j = JSON.parse(raw.slice(i + 1));
    return { prose, out: j.out ?? null, dropped: Array.isArray(j.dropped) ? j.dropped : [] };
  } catch { return { prose, out: null, dropped: [] }; }
}

/** R2: TARGETS[t].model is a hint; first installed checkpoint containing it (case-insensitive), else the fallback. */
export const resolveModel = (hint: string, installed: string[], fallback: string) =>
  installed.find((m) => m.toLowerCase().includes(hint.toLowerCase())) ?? fallback;
