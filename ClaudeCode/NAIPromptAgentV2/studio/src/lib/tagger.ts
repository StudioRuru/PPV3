export type RawTag = { name: string; category: string; score: number; group?: number };
export type TagOpts = { thresholds: Record<string, number>; enabled: Record<string, boolean>; exclude: string[]; groups?: number[] };

/** Prompt order: who → what series → general (by YAML group) → artists → meta → rating. */
const CATEGORY_ORDER = ["character", "copyright", "general", "style", "meta", "rating"];

export const DEFAULT_ENABLED: Record<string, boolean> = {
  character: true, copyright: true, general: true, style: true, meta: false, rating: false,
};

export const DEFAULT_EXCLUDE = ["watermark", "text", "signature", "artist name", "web address", "patreon username"];

const spaced = (s: string) => s.replace(/_/g, " ").trim();

export function toPromptTag(t: RawTag): string {
  return t.category === "style" ? `artist:${t.name}` : spaced(t.name);
}

export function filterTags(tags: RawTag[], o: TagOpts): string[] {
  const excluded = new Set(o.exclude.map((e) => spaced(e).toLowerCase()).filter(Boolean));
  const rank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  return tags
    .filter((t) => o.enabled[t.category] && t.score >= (o.thresholds[t.category] ?? 0.2) && !excluded.has(spaced(t.name).toLowerCase())
      && (t.category !== "general" || !o.groups || o.groups.includes(t.group ?? 6)))
    .sort((a, b) => rank(a.category) - rank(b.category) || (a.group ?? 99) - (b.group ?? 99) || b.score - a.score)
    .map(toPromptTag);
}

export type Preset = {
  id: string; name: string; enabled: Record<string, boolean>; groups?: number[];
  thresholds?: Record<string, number>; exclude?: string[]; user?: boolean;
};

/** Group numbers come from tags.ts GROUP_RANK: 0 subject, 1 appearance, 2 clothing, 3 states, 4 pose, 5 setting, 6 other. */
export const BUILTIN_PRESETS: Preset[] = [
  { id: "full", name: "Full scene", enabled: DEFAULT_ENABLED },
  { id: "outfit", name: "Outfit only", enabled: { general: true }, groups: [2, 3] },
  { id: "char-artist", name: "Char + artist", enabled: { character: true, copyright: true, general: true, style: true }, groups: [0, 1] },
];

export type ChipState = Record<string, { dropped?: boolean; weight?: number }>;

export function chipsToText(tags: string[], st: ChipState): string {
  return tags.filter((t) => !st[t]?.dropped).map((t) => (st[t]?.weight ? `${st[t].weight}::${t}::` : t)).join(", ");
}
