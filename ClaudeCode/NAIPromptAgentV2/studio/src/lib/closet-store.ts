import fs from "node:fs";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { slugify } from "./blocks";
import { addScene, DIRS, patchText, removeScene, safeRef, toFields, toText, type Field, type Kind } from "./closet";
import { DATA_DIR } from "./env";

export type ClosetItem = { kind: Kind; dir: string; slug: string; name: string; description: string; count: number; mtime: number };

const file = (dir: string, slug: string, root = DATA_DIR) => path.join(root, dir, `${slug}.yaml`);

/** tmp + rename, keeping the previous version as .bak (the skills share these files). */
function writeAtomic(target: string, text: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
}

export function listCloset(root = DATA_DIR): ClosetItem[] {
  return (Object.entries(DIRS) as [Kind, string][]).flatMap(([kind, dir]) => {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith(".yaml")).flatMap((f): ClosetItem[] => {
      const slug = f.replace(/\.yaml$/, "");
      try {
        const p = path.join(d, f);
        const js = parseDocument(fs.readFileSync(p, "utf8")).toJS() ?? {};
        const count = kind === "arc" ? (js.scenes?.length ?? 0) : kind === "cluster" ? (js.tags?.length ?? 0)
          : kind === "outfit" ? Object.values(js.tags ?? {}).flat().length : (js.character_layer?.anchors?.length ?? 0) + (js.base_layer?.effects?.length ?? 0);
        return [{ kind, dir, slug, name: js.name ?? slug, description: String(js.description ?? js.notes ?? "").trim(), count, mtime: fs.statSync(p).mtimeMs }];
      } catch { return []; }
    });
  }).sort((a, b) => b.mtime - a.mtime);
}

export function readItem(dir: string, slug: string, root = DATA_DIR) {
  const ref = safeRef(dir, slug);
  if (!ref) return null;
  const p = file(dir, slug, root);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  return { ...ref, fields: toFields(ref.kind, parseDocument(text)), mtime: fs.statSync(p).mtimeMs };
}

export class Conflict extends Error {}

/** Save edited fields. `mtime` is what the editor opened; if the file changed since (a skill wrote it), refuse. */
export function saveItem(dir: string, slug: string, fields: Field[], mtime: number, op?: { scene: "add" } | { scene: "remove"; index: number }, root = DATA_DIR) {
  const ref = safeRef(dir, slug);
  if (!ref) throw new Error("Unknown item.");
  const p = file(dir, slug, root);
  if (Math.abs(fs.statSync(p).mtimeMs - mtime) > 1) throw new Conflict("This item was changed on disk since you opened it — reload to see the new version.");
  let text = patchText(fs.readFileSync(p, "utf8"), fields);
  if (op && ref.kind === "arc") {
    const doc = parseDocument(text);
    if (op.scene === "add") addScene(doc); else removeScene(doc, op.index);
    text = toText(doc);
  }
  writeAtomic(p, text);
  return readItem(dir, slug, root)!;
}

const TEMPLATES: Record<Kind, (name: string) => object> = {
  cluster: (name) => ({ name, kind: "cluster", tags: [], notes: "" }),
  outfit: (name) => ({ name, created: new Date().toISOString().slice(0, 10), description: "", tags: { tops: [], bottoms: [], legwear: [], footwear: [], accessories: [] }, weight_overrides: { emphasized: [] } }),
  theme: (name) => ({ name, description: "", base_layer: { effects: [] }, character_layer: { anchors: [], support: [] }, clean_cut_negatives: [] }),
  arc: (name) => ({ name, created: new Date().toISOString().slice(0, 10), description: "", artist: "", scenes: [{ scene_number: 1, title: "Scene 1", narrative: "", prompt: { base: "", character: "", undesired: "" } }] }),
};

function freeSlug(dir: string, base: string, root: string): string {
  let slug = base, n = 2;
  while (fs.existsSync(file(dir, slug, root))) slug = `${base}-${n++}`.slice(0, 64);
  return slug;
}

/** New item from a template (optionally pre-filled), or a duplicate of an existing one. Never overwrites. */
export function createItem(kind: Kind, name: string, opts: { from?: { dir: string; slug: string }; fields?: Field[] } = {}, root = DATA_DIR) {
  const dir = DIRS[kind];
  const slug = freeSlug(dir, slugify(name) ?? "untitled", root);
  let text: string;
  if (opts.from) {
    const src = safeRef(opts.from.dir, opts.from.slug);
    if (!src || src.kind !== kind) throw new Error("Unknown item.");
    const doc = parseDocument(fs.readFileSync(file(src.dir, src.slug, root), "utf8"));
    doc.set("name", name);
    text = toText(doc);
  } else {
    text = stringify(TEMPLATES[kind](name));
  }
  if (opts.fields) text = patchText(text, opts.fields.filter((f) => f.path.join(".") !== "name"));
  writeAtomic(file(dir, slug, root), text);
  return readItem(dir, slug, root)!;
}

/** Never erases: moves to data/.trash/<dir>/<slug>.<time>.yaml. */
export function trashItem(dir: string, slug: string, root = DATA_DIR): void {
  if (!safeRef(dir, slug)) throw new Error("Unknown item.");
  const p = file(dir, slug, root);
  const dest = path.join(root, ".trash", dir, `${slug}.${Date.now()}.yaml`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(p, dest);
}
