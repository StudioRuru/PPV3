import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { arcToBlocks, clusterToBlock, outfitToBlock, slugify, themeToBlock, type Block } from "./blocks";
import { DATA_DIR } from "./env";
import { BUILTIN_PRESETS, type Preset } from "./tagger";

/** Read every *.yaml in a folder; a broken file is skipped, never fatal. */
function readDir(dir: string): [string, unknown][] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f): [string, unknown][] => {
    try { return [[f.replace(/\.yaml$/, ""), parse(fs.readFileSync(path.join(dir, f), "utf8"))]]; } catch { return []; }
  });
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function listBlocks(dataDir = DATA_DIR): Block[] {
  const at = (sub: string) => readDir(path.join(dataDir, sub));
  return [
    ...at("themes").map(([s, d]) => themeToBlock(s, d)),
    ...at("clusters").map(([s, d]) => clusterToBlock(s, d)),
    ...at("outfits").map(([s, d]) => outfitToBlock(s, d)),
    ...at("arcs").flatMap(([s, d]) => arcToBlocks(s, d)),
  ];
}

export function saveCluster(input: { name: string; kind: "cluster" | "theme"; tags: string[]; notes?: string }, dataDir = DATA_DIR): Block {
  const slug = slugify(String(input.name ?? ""));
  if (!slug) throw new Error("Give the group a name with letters or numbers.");
  const tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim()).filter(Boolean);
  if (!tags.length) throw new Error("A group needs at least one tag.");
  const doc = { name: input.name.trim(), kind: input.kind === "theme" ? "theme" : "cluster", tags, ...(input.notes ? { notes: input.notes } : {}) };
  writeAtomic(path.join(dataDir, "clusters", `${slug}.yaml`), stringify(doc));
  return clusterToBlock(slug, doc);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Keep only well-typed preset fields — a hand-edited file must not crash the tag filter. */
function cleanPreset(d: unknown, id: string): Preset {
  const o = isObj(d) ? d : {};
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : undefined);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return {
    id, user: true, name: typeof o.name === "string" ? o.name : id,
    enabled: isObj(o.enabled) ? Object.fromEntries(Object.entries(o.enabled).map(([k, v]) => [k, v === true])) : {},
    groups: nums(o.groups),
    thresholds: isObj(o.thresholds) ? Object.fromEntries(Object.entries(o.thresholds).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined,
    exclude: strs(o.exclude),
  };
}

export function listPresets(dataDir = DATA_DIR): Preset[] {
  const user = readDir(path.join(dataDir, "presets")).map(([s, d]) => cleanPreset(d, s));
  return [...BUILTIN_PRESETS, ...user];
}

export function savePreset(input: Omit<Preset, "id" | "user">, dataDir = DATA_DIR): Preset {
  const slug = slugify(String(input.name ?? ""));
  if (!slug || BUILTIN_PRESETS.some((p) => p.id === slug)) throw new Error("Give the preset a new name with letters or numbers.");
  const clean = cleanPreset({ ...input, name: String(input.name).trim() }, slug);
  const { id: _id, user: _user, ...doc } = clean;
  writeAtomic(path.join(dataDir, "presets", `${slug}.yaml`), stringify(JSON.parse(JSON.stringify(doc))));
  return clean;
}
