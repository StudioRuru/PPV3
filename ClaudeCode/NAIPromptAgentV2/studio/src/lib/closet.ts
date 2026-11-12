import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";

/**
 * Closet editing of the shared data/ YAML (also read by the /prompt and /story skills).
 * Only fields listed here are edited, and only when their value changed — so comments, key order,
 * quoting and every other field in a hand-written file survive a save.
 */
export type Kind = "arc" | "outfit" | "theme" | "cluster";
export const DIRS: Record<Kind, string> = { arc: "arcs", outfit: "outfits", theme: "themes", cluster: "clusters" };
export type Path = (string | number)[];
/** readonly: the file holds something other than text / a list of strings here — shown, never written. */
export type Field = { path: Path; label: string; type: "text" | "long" | "tags"; value: string | string[]; readonly?: boolean };

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
  const text = (path: Path, label: string, type: "text" | "long" = "text"): Field => {
    const raw = at(js, path);
    return { path, label, type, value: str(raw), ...(raw != null && typeof raw !== "string" && { readonly: true }) };
  };
  const tags = (path: Path, label: string): Field => {
    const raw = at(js, path);
    const ok = raw == null || (Array.isArray(raw) && raw.every((x) => typeof x === "string"));
    return { path, label, type: "tags", value: strs(raw), ...(!ok && { readonly: true }) };
  };
  switch (kind) {
    case "cluster":
      return [text(["name"], "Name"), text(["notes"], "Notes", "long"), tags(["tags"], "Tags")];
    case "outfit":
      return [text(["name"], "Name"), text(["description"], "Description", "long"),
        ...Object.keys(js.tags ?? {}).map((slot) => tags(["tags", slot], cap(slot))),
        tags(["weight_overrides", "emphasized"], "Emphasized"),
        // Photo-read extras that aren't real tags: shown tinted, never part of the outfit block.
        ...(Array.isArray(js.optional) ? [tags(["optional"], "Optional")] : [])];
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
    if (f.readonly) continue;
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

const valueOf = (js: unknown, f: Field) => (f.type === "tags" ? strs(at(js, f.path)) : str(at(js, f.path)));

/**
 * Save edits by replacing only each changed field's text — from just after its key's ":" to the end of its
 * value — so every other byte of a hand-written file (comments, folded paragraphs, spacing, CRLF) stays as it was.
 * Values are written as quoted YAML (a changed folded `>` block or block list becomes one line). A key that doesn't
 * exist yet falls back to a full re-render. The result is re-read before it's returned: if it isn't valid YAML with
 * exactly the intended values, this throws and nothing gets written.
 */
export function patchText(source: string, fields: Field[]): string {
  const doc = parseDocument(source);
  const js = doc.toJS() ?? {};
  const changed = fields.filter((f) => !f.readonly && !same(valueOf(js, f), f.value));
  if (!changed.length) return source;
  const crlf = source.includes("\r\n");
  const render = (f: Field) => (f.type === "tags" ? `[${(f.value as string[]).map((v) => JSON.stringify(v)).join(", ")}]` : JSON.stringify(f.value));
  const edits: { start: number; end: number; text: string }[] = [];
  let out: string | null = null;
  for (const f of changed) {
    const parent = f.path.length > 1 ? doc.getIn(f.path.slice(0, -1), true) : doc.contents;
    const pair = isMap(parent) ? parent.items.find((p) => isScalar(p.key) && p.key.value === f.path.at(-1)) : undefined;
    const keyEnd = pair && isScalar(pair.key) ? pair.key.range?.[1] : undefined;
    if (keyEnd === undefined) { out = toText(applyFields(parseDocument(source), fields)); break; }
    const colon = source.indexOf(":", keyEnd);
    const node = pair!.value as { range?: [number, number, number] } | null;
    const end = node?.range ? Math.max(node.range[1], colon + 1) : colon + 1;
    const tail = source.slice(colon + 1, end).match(/\r?\n[\r\n]*$/)?.[0] ?? "";
    edits.push({ start: colon + 1, end, text: ` ${render(f)}${tail}` });
  }
  out ??= edits.sort((x, y) => y.start - x.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), source);
  if (crlf) out = out.replace(/\r?\n/g, "\r\n");
  const check = parseDocument(out);
  const back = check.toJS() ?? {};
  if (check.errors.length || changed.some((f) => !same(valueOf(back, f), f.value))) {
    throw new Error("Couldn't save this edit safely, so nothing was written. Try editing a different field, or edit the file by hand.");
  }
  return out;
}

/** Serialise without re-padding flow lists, so untouched lines stay byte-identical. */
export const toText = (doc: Document) => doc.toString({ flowCollectionPadding: false, lineWidth: 0 });

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
  add: "Add to the item (new tags or details) as the user asks; keep everything that's there.",
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
