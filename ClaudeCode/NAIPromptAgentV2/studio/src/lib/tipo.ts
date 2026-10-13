import { splitTags } from "./prompt";

const RATING = { safe: "safe", nsfw: "nsfw", off: "" } as const;

/** TIPO v2.1 header with the tag line left open: the model continues the tag list. */
export function tipoPrompt(tags: string, rating: "safe" | "nsfw" | "off"): string {
  const r = RATING[rating];
  return `quality: masterpiece, newest\n${r ? `rating: ${r}\n` : ""}target: <|long|>\ntag: ${tags}`;
}

/** New tags from TIPO's continuation (first line) and any `tag:` lines — not in the input, unique, capped. */
export function newTags(output: string, input: string, limit = 12): string[] {
  const have = new Set(splitTags(input).map((t) => t.toLowerCase()));
  const out: string[] = [];
  const lines = output.split("\n");
  const sources = [lines[0], ...lines.slice(1).map((l) => l.match(/^(?:tag|general):\s*(.*)$/i)?.[1]).filter((l): l is string => l !== undefined)];
  for (const src of sources) {
    if (/^\s*(long|short|quality|rating|target|meta|artist|characters|copyrights|aspect ratio):/i.test(src)) continue;
    for (const raw of splitTags(src.replace(/<\|[^|]*\|>/g, ""))) {
      const t = raw.trim();
      if (!t || t.length >= 60 || have.has(t.toLowerCase())) continue;
      have.add(t.toLowerCase());
      out.push(t);
      if (out.length === limit) return out;
    }
  }
  return out;
}
