import { newLine, type PromptState, type Rating } from "./prompt";
import { DEFAULT_EXCLUDE, toPromptTag, type RawTag } from "./tagger";

export { keepTags } from "./tagger";

/**
 * Found tags → a V5 prompt. Base: subject count, setting, artists. Character 1: who, look, outfit/states, pose/other.
 * Group numbers are tags.ts GROUP_RANK (0 subject … 6 other). Keeps UC and rating; positions back to AI.
 * ponytail: multi-character images all land on Character 1 — tags can't be split per character reliably.
 */
export function recreate(tags: RawTag[], s: PromptState): PromptState {
  const join = (pick: (t: RawTag) => boolean) => tags.filter(pick).map(toPromptTag).join(", ");
  const g = (...n: number[]) => (t: RawTag) => t.category === "general" && n.includes(t.group ?? 6);
  const base = [join(g(0)), join(g(5)), join((t) => t.category === "style")].filter(Boolean);
  const char = [join((t) => t.category === "character" || t.category === "copyright"), join(g(1)), join(g(2, 3)), join(g(4, 6))].filter(Boolean);
  return {
    ...s,
    base: base.length ? base.map((t) => newLine(t)) : [newLine()],
    chars: char.length ? [{ id: `c${Date.now().toString(36)}`, lines: char.map((t) => newLine(t)), uc: "", enabled: true }] : [],
    positions: "ai",
  };
}

export type DanbooruPost = { tag_string_character: string; tag_string_copyright: string; tag_string_artist: string; tag_string_general: string };

const EXCLUDED = new Set(DEFAULT_EXCLUDE.map((e) => e.replace(/ /g, "_")));

/** Post tag strings → categorised tags, minus the same junk the tagger drops (signature, text, …). */
export function danbooruTags(p: DanbooruPost, groupOf: (name: string) => number): RawTag[] {
  const split = (s: string, category: string) => s.split(" ").filter((n) => n && !EXCLUDED.has(n)).map((name) => ({ name, category, score: 1 } as RawTag));
  return [
    ...split(p.tag_string_character, "character"), ...split(p.tag_string_copyright, "copyright"), ...split(p.tag_string_artist, "style"),
    ...split(p.tag_string_general, "general").map((t) => ({ ...t, group: groupOf(t.name.replace(/_/g, " ")) })),
  ];
}

const RATING_Q: Record<Rating, string> = { safe: "rating:g", nsfw: "rating:q,e", off: "" };

/** "hatsune miku, smile" + rating → "hatsune_miku smile rating:g" (comma-separated tags, spaces → underscores). */
export function danbooruQuery(q: string, rating: Rating): string {
  return [...q.split(",").map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean), RATING_Q[rating]].filter(Boolean).join(" ");
}
