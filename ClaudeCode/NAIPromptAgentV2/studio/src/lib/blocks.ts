import { applyTags, emptyState, newLine, parseToLines, splitTags, type PromptState } from "./prompt";

export type BlockKind = "cluster" | "theme" | "outfit" | "scene";
export type Block = { id: string; kind: BlockKind; name: string; base: string[]; char: string[]; uc: string[]; note?: string; user: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any -- YAML docs are user-authored and loosely shaped */
const list = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : []);
const uniq = (xs: string[]) => [...new Set(xs)];

export function slugify(name: string): string | null {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return s ? s : null;
}

export function outfitToBlock(slug: string, doc: any): Block {
  const strong = new Set(list(doc?.weight_overrides?.emphasized));
  const all = uniq(Object.values(doc?.tags ?? {}).flatMap(list));
  return { id: `outfit:${slug}`, kind: "outfit", name: doc?.name ?? slug, base: [], char: all.map((t) => (strong.has(t) ? `1.15::${t}::` : t)), uc: [], note: doc?.description, user: false };
}

export function themeToBlock(slug: string, doc: any): Block {
  return {
    id: `theme:${slug}`, kind: "theme", name: doc?.name ?? slug,
    base: list(doc?.base_layer?.effects),
    char: uniq([...list(doc?.character_layer?.anchors), ...list(doc?.character_layer?.support)]),
    uc: uniq([...list(doc?.clean_cut_negatives), ...list(doc?.safety_negatives)]),
    note: doc?.applies_to, user: false,
  };
}

export function arcToBlocks(slug: string, doc: any): Block[] {
  return (Array.isArray(doc?.scenes) ? doc.scenes : [])
    .filter((s: any) => s?.prompt?.base || s?.prompt?.character)
    .map((s: any) => ({
      id: `scene:${slug}#${s.scene_number}`, kind: "scene" as const,
      name: `${doc?.name ?? slug} · ${s.scene_number} ${s.title ?? ""}`.trim(),
      base: splitTags(s.prompt.base ?? ""), char: splitTags(s.prompt.character ?? ""), uc: splitTags(s.prompt.undesired ?? ""),
      note: s.narrative, user: false,
    }));
}

export function clusterToBlock(slug: string, doc: any): Block {
  return { id: `cluster:${slug}`, kind: doc?.kind === "theme" ? "theme" : "cluster", name: doc?.name ?? slug, base: [], char: list(doc?.tags), uc: [], note: doc?.notes, user: true };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Add a block: its character tags go to `target`, its base effects always to the base, its negatives to the UC. */
export function applyBlock(s: PromptState, b: Block, target: "base" | number): PromptState {
  let out = s;
  // A theme's figure tags never share the base with its effects: "Base" sends them to character 1.
  const charTarget = target === "base" && b.base.length ? 0 : target;
  if (b.char.length) out = applyTags(out, charTarget, "append", b.char.join(", "));
  if (b.base.length) out = applyTags(out, "base", "append", b.base.join(", "));
  if (b.uc.length) {
    const have = new Set(splitTags(out.uc).map((t) => t.toLowerCase()));
    const add = b.uc.filter((t) => !have.has(t.toLowerCase()));
    if (add.length) out = { ...out, uc: [out.uc.trim(), ...add].filter(Boolean).join(", ") };
  }
  return out;
}

/** An arc scene replaces the editor: base, one character, its UC, AI positions. */
export function loadScene(b: Block): PromptState {
  return {
    ...emptyState(), rating: "off", positions: "ai",
    base: parseToLines(b.base.join(", ")),
    chars: b.char.length ? [{ id: newLine().id, lines: parseToLines(b.char.join(", ")), uc: "", enabled: true }] : [],
    uc: b.uc.join(", "),
  };
}
