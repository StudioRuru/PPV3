import type { Surface } from "./core";

/** Validates a POST /api/sprites/cells body: an endpoint ({from}) or a clip ({from,to}) of existing keys. */
export function cellRef(b: Record<string, unknown> | null, outfits: string[], keys: { surface: Surface; key: string }[]): { surface: Surface; outfit: string; from: string; to: string } | string {
  if (!b || (b.surface !== "chat" && b.surface !== "stage")) return "Need a surface.";
  if (typeof b.outfit !== "string" || !outfits.includes(b.outfit)) return "Unknown outfit.";
  const ok = new Set(keys.filter((k) => k.surface === b.surface).map((k) => k.key));
  const to = b.to == null || b.to === "" ? "" : b.to;
  if (typeof b.from !== "string" || !ok.has(b.from) || typeof to !== "string" || (to !== "" && !ok.has(to))) return "Unknown key.";
  return { surface: b.surface, outfit: b.outfit, from: b.from, to };
}
