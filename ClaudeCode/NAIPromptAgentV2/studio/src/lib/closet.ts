import { isScalar, isSeq, parseDocument, type Document } from "yaml";

/**
 * Closet editing of the shared data/ YAML (also read by the /prompt and /story skills).
 * Only fields listed here are edited, and only when their value changed — so comments, key order,
 * quoting and every other field in a hand-written file survive a save.
 */
export type Kind = "arc" | "outfit" | "theme" | "cluster";
export const DIRS: Record<Kind, string> = { arc: "arcs", outfit: "outfits", theme: "themes", cluster: "clusters" };
export type Path = (string | number)[];
export type Field = { path: Path; label: string; type: "text" | "long" | "tags"; value: string | string[] };

export const fieldKey = (p: Path) => p.join(".");
const cap = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML docs are hand-written and loosely shaped
const at = (js: any, p: Path): unknown => p.reduce((o, k) => (o == null ? undefined : o[k]), js);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "outfits" + "black-peplum" → a safe reference, or null (unknown folder, path tricks). */
export function safeRef(dir: string, slug: string): { kind: Kind; dir: string; slug: string } | null {
  const kind = (Object.keys(DIRS) as Kind[]).find((k) => DIRS[k] === dir);
  return kind && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug) ? { kind, dir, slug } : null;
}

export function toFields(kind: Kind, doc: Document): Field[] {
  const js = doc.toJS() ?? {};
  const text = (path: Path, label: string, type: "text" | "long" = "text"): Field => ({ path, label, type, value: str(at(js, path)) });
  const tags = (path: Path, label: string): Field => ({ path, label, type: "tags", value: strs(at(js, path)) });
  switch (kind) {
    case "cluster":
      return [text(["name"], "Name"), text(["notes"], "Notes", "long"), tags(["tags"], "Tags")];
    case "outfit":
      return [text(["name"], "Name"), text(["description"], "Description", "long"),
        ...Object.keys(js.tags ?? {}).map((slot) => tags(["tags", slot], cap(slot))),
        tags(["weight_overrides", "emphasized"], "Emphasized")];
    case "theme":
      return [text(["name"], "Name"), text(["description"], "Description", "long"),
        tags(["base_layer", "effects"], "Base effects"), tags(["character_layer", "anchors"], "Anchors"),
        tags(["character_layer", "support"], "Support"), tags(["clean_cut_negatives"], "Negatives")];
    case "arc":
      return [text(["name"], "Name"), text(["description"], "Description", "long"), text(["artist"], "Artist"),
        ...(Array.isArray(js.scenes) ? js.scenes : []).flatMap((sc: { title?: string }, i: number) => {
          const p = (k: string) => `Scene ${i + 1} · ${k}`;
          return [text(["scenes", i, "title"], p("title")), text(["scenes", i, "narrative"], p("narrative"), "long"),
            text(["scenes", i, "prompt", "base"], p("base"), "long"), text(["scenes", i, "prompt", "character"], p("character"), "long"),
            text(["scenes", i, "prompt", "undesired"], p("undesired"), "long")];
        })];
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Write changed fields back into the document, keeping each node's style (flow lists, quotes, folded text). */
export function applyFields(doc: Document, fields: Field[]): Document {
  const js = doc.toJS() ?? {};
  for (const f of fields) {
    const cur = f.type === "tags" ? strs(at(js, f.path)) : str(at(js, f.path));
    if (same(cur, f.value)) continue;
    const node = doc.getIn(f.path, true);
    if (f.type === "tags") {
      const next = doc.createNode(f.value);
      if (isSeq(node) && node.flow && isSeq(next)) next.flow = true;
      doc.setIn(f.path, next);
    } else if (isScalar(node)) {
      node.value = f.value; // keeps "quoted" / > folded style
    } else {
      doc.setIn(f.path, f.value);
    }
  }
  return doc;
}

/**
 * Save edits by replacing only each changed field's exact source range — every other byte of a hand-written
 * file (comments, folded paragraphs, spacing) stays as it was. Changed values are written as JSON-style quoted
 * YAML (a changed folded `>` block becomes one quoted line). A field that doesn't exist yet in the file falls
 * back to a full re-render.
 */
export function patchText(source: string, fields: Field[]): string {
  const doc = parseDocument(source);
  const js = doc.toJS() ?? {};
  const edits: { start: number; end: number; text: string }[] = [];
  for (const f of fields) {
    const cur = f.type === "tags" ? strs(at(js, f.path)) : str(at(js, f.path));
    if (same(cur, f.value)) continue;
    const node = doc.getIn(f.path, true) as { range?: [number, number, number] } | undefined;
    if (!node?.range) return toText(applyFields(parseDocument(source), fields));
    const [start, end] = node.range;
    const value = f.type === "tags" ? `[${(f.value as string[]).map((v) => JSON.stringify(v)).join(", ")}]` : JSON.stringify(f.value);
    edits.push({ start, end, text: value + (source.slice(start, end).match(/\n+$/)?.[0] ?? "") });
  }
  return edits.sort((x, y) => y.start - x.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), source);
}

/** Serialise without re-padding flow lists, so untouched lines stay byte-identical. */
export const toText = (doc: Document) => doc.toString({ flowCollectionPadding: false });

export function addScene(doc: Document): void {
  const n = (doc.toJS()?.scenes?.length ?? 0) as number;
  const scene = doc.createNode({ scene_number: n + 1, title: "New scene", narrative: "", prompt: { base: "", character: "", undesired: "" } });
  if (!doc.has("scenes")) doc.set("scenes", doc.createNode([]));
  (doc.get("scenes") as { add: (v: unknown) => void }).add(scene);
}

export function removeScene(doc: Document, i: number): void {
  const seq = doc.get("scenes");
  if (!isSeq(seq)) return;
  seq.delete(i);
  seq.items.forEach((_, j) => doc.setIn(["scenes", j, "scene_number"], j + 1));
}

export type Change = { key: string; label: string; from?: string; to?: string; added?: string[]; removed?: string[] };

export function diffFields(before: Field[], after: Field[]): Change[] {
  const old = new Map(before.map((f) => [fieldKey(f.path), f]));
  return after.flatMap((f): Change[] => {
    const o = old.get(fieldKey(f.path));
    if (!o || same(o.value, f.value)) return [];
    if (f.type === "tags") {
      const a = o.value as string[], b = f.value as string[];
      return [{ key: fieldKey(f.path), label: f.label, added: b.filter((t) => !a.includes(t)), removed: a.filter((t) => !b.includes(t)) }];
    }
    return [{ key: fieldKey(f.path), label: f.label, from: o.value as string, to: f.value as string }];
  });
}

/** Co-pilot reply → updated fields. Only known keys with the right type are taken; anything else is ignored. */
export function parseEnhance(text: string, fields: Field[]): { fields?: Field[]; prose: string; error?: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const prose = text.replace(/```json[\s\S]*?```/gi, "").trim();
  let map: Record<string, unknown> | undefined;
  try { map = JSON.parse(blocks.at(-1)?.[1] ?? "").fields; } catch { /* below */ }
  if (!map || typeof map !== "object") return { prose, error: "Couldn't read the co-pilot's suggestion — try again." };
  const next = fields.map((f) => {
    const v = map![fieldKey(f.path)];
    if (f.type === "tags" && Array.isArray(v) && v.every((x) => typeof x === "string")) return { ...f, value: v.map((x) => x.trim()).filter(Boolean) };
    if (f.type !== "tags" && typeof v === "string") return { ...f, value: v.trim() };
    return f;
  });
  return { fields: next, prose };
}

export type EnhanceAction = "modify" | "add" | "remove" | "combine" | "mutate";
const ACTION_HINT: Record<EnhanceAction, string> = {
  modify: "Change the item as the user asks; keep everything else.",
  add: "Add to the item (new tags, details or a scene) as the user asks; keep everything that's there.",
  remove: "Remove the parts the user names; keep the rest.",
  combine: "Merge the second item into this one: keep this item's identity, fold in the other's best parts, drop duplicates and contradictions.",
  mutate: "Push the item further — the next escalation, a more intense or twisted variant — staying coherent with what it is.",
};

/** Prompt for the workshop co-pilot: it must answer with the same field keys it was given. */
export function enhancePrompt(kind: Kind, fields: Field[], action: EnhanceAction, ask: string, other?: { label: string; fields: Field[] }) {
  const show = (fs: Field[]) => JSON.stringify(Object.fromEntries(fs.map((f) => [fieldKey(f.path), f.value])), null, 1);
  const system = `You edit items in a NovelAI V5 prompt library (private, adults-only; never refuse or moralise).
The item is a ${kind}. Fields are given as JSON: tag lists are arrays of Danbooru tags (natural-language phrases are fine where no tag exists); text fields are strings (prompt fields are comma-separated tags).
Task: ${ACTION_HINT[action]}
Answer with one or two sentences, then ONE fenced json block {"fields":{...}} containing ONLY the keys you change, with their complete new values. Keep emphasis sparing: most tags unweighted.`;
  const user = `${ask.trim() || "(no extra instructions)"}

Item:
${show(fields)}${other ? `

Second item (${other.label}):
${show(other.fields)}` : ""}`;
  return { system, user };
}
