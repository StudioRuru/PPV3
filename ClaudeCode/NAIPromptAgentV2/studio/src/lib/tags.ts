export type TagEntry = { name: string; category: string; count: number; aliases: string[]; source: "danbooru" | "yaml" | "v5" };

const CATEGORY: Record<string, string> = { "0": "general", "1": "artist", "3": "copyright", "4": "character", "5": "meta" };

/** V5-only tags (spec §2); not in Danbooru counts, so listed explicitly. */
export const V5_TAGS = [
  "high complexity", "low complexity", "medium complexity", "ultra complexity",
  "transparent background", "has alpha", "alpha transparency", "depthness",
  "meta:novel era", "meta:golden era", "visual novel art", "visual novel bg", "visual novel cg",
  "visual novel chibi", "visual novel sprite", "attractive male", "fur dataset", "background dataset",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/_/g, " ");

export function parseDanbooruCsv(csv: string): TagEntry[] {
  const out: TagEntry[] = [];
  for (const line of csv.split("\n")) {
    const m = line.match(/^([^,]+),(\d+),(\d+),"?([^"]*)"?\s*$/);
    if (!m) continue;
    out.push({
      name: norm(m[1]),
      category: CATEGORY[m[2]] ?? "general",
      count: Number(m[3]),
      aliases: m[4] ? m[4].split(",").map(norm).filter(Boolean) : [],
      source: "danbooru",
    });
  }
  return out;
}

export function yamlTagNames(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (k === "tag" && typeof val === "string") out.push(norm(val));
        else walk(val);
      }
    }
  };
  walk(doc);
  return out;
}

export function buildIndex(entries: TagEntry[]): TagEntry[] {
  const map = new Map<string, TagEntry>();
  for (const e of entries) {
    const prev = map.get(e.name);
    if (!prev || e.count > prev.count) map.set(e.name, prev ? { ...e, aliases: [...new Set([...prev.aliases, ...e.aliases])] } : e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ponytail: linear scan over ~140k entries (~5 ms); add a prefix trie if typing ever lags.
export function suggest(index: TagEntry[], q: string, limit = 15): TagEntry[] {
  const n = norm(q);
  if (!n) return [];
  const prefix: TagEntry[] = [], alias: TagEntry[] = [], contains: TagEntry[] = [];
  for (const t of index) {
    if (t.name.startsWith(n)) prefix.push(t);
    else if (t.aliases.some((a) => a.startsWith(n))) alias.push(t);
    else if (t.name.includes(n)) contains.push(t);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...alias, ...contains].slice(0, limit);
}

export function dots(count: number): 0 | 1 | 2 | 3 {
  return count >= 100_000 ? 3 : count >= 10_000 ? 2 : count >= 1_000 ? 1 : 0;
}
