# NAI V5 Studio — Plan 3: Library, Split Desk + Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag images inside the Studio (a split "desk" pane above the prompt), edit tags as chips (tap = drop, hold = boost, drag onto Base or a character row), and open a building-block drawer that adds tagger presets, theme/fetish groups, user clusters, Library outfits and arc scenes before sending.

**Architecture:** Everything the drawer offers is one `Block` shape (`base` / `char` / `uc` tag lists) built by pure converters from the existing YAML (`data/outfits`, `data/themes`, `data/arcs`) plus new user files in `data/clusters` and `data/presets`. A `/api/blocks` and `/api/presets` pair reads and atomically writes those folders. The Studio page gains a `TaggerPane` (upload, chips, drag sources) and a `BlockDrawer`; base and character boxes become drop targets. The standalone `/tagger` page and the tab bar are deleted (the desk replaces them).

**Tech Stack:** existing Next.js 16 app + `yaml`; pointer events for touch drag; `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` (§4.4, §4.5, §4.7 "Design challenge 2"; phase 4)

## Global Constraints

- Repo root `/Users/rurudayo/ClaudeCode/NAIPromptAgentV2`; enclosing git repo is the home dir. Commit with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit …`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only named files.
- User files: `data/clusters/<slug>.yaml` `{name, kind: cluster|theme, tags: [..], notes?}`; `data/presets/<slug>.yaml` `{name, enabled, groups?, thresholds?, exclude?}`. Slugs `^[a-z0-9][a-z0-9-]{0,63}$`. Writes are atomic (temp + rename). Existing YAML in `data/outfits|themes|arcs` is read-only here.
- Weights only as `w::tag::`. Tag form: spaces, `artist:name`.
- Touch targets ≥ 44 px; drag must have tap fallbacks ("All → Base", "All → new character", Send).
- "Suggested for this image" needs the co-pilot (Plan 4): render the section with an honest "Available when the co-pilot is on" line, no fake suggestions.

## Review Focus

1. **Theme blocks put effects in the base and figure tags in the character** — never all into one box (themes say base effects in a character box break them). → test in Task 1.
2. **Saving a cluster with a hostile or odd name** (`../x`, emoji, empty) must not write outside `data/clusters` or crash. → test in Task 2.
3. **Dropped chips and boosted weights survive into the sent text exactly** (dropped never sent, boosted as `1.15::tag::`). → test in Task 1.
4. **Loading an arc scene replaces the editor cleanly** (base, one character, UC; positions back to AI). → test in Task 1.
5. **Drag on a phone must not scroll the page or select text mid-drag**, and a plain tap must not be read as a drag. → browser check in Task 4.

---

### Task 1: Blocks, chips and presets (pure logic)

**Files:**
- Create: `studio/src/lib/blocks.ts`
- Test: `studio/src/lib/blocks.test.ts`
- Modify: `studio/src/lib/tagger.ts` (presets, `groups` filter, chip text)
- Modify: `studio/src/lib/tagger.test.ts`

**Interfaces:**
- Consumes: `PromptState`, `emptyState`, `newLine`, `parseToLines`, `splitTags`, `applyTags` (prompt.ts).
- Produces:
  ```ts
  // blocks.ts
  type BlockKind = "cluster" | "theme" | "outfit" | "scene";
  type Block = { id: string; kind: BlockKind; name: string; base: string[]; char: string[]; uc: string[]; note?: string; user: boolean };
  function outfitToBlock(slug: string, doc: any): Block;
  function themeToBlock(slug: string, doc: any): Block;
  function arcToBlocks(slug: string, doc: any): Block[];
  function clusterToBlock(slug: string, doc: any): Block;
  function applyBlock(s: PromptState, b: Block, target: "base" | number): PromptState;
  function loadScene(b: Block): PromptState;
  function slugify(name: string): string | null;
  // tagger.ts additions
  type Preset = { id: string; name: string; enabled: Record<string, boolean>; groups?: number[]; thresholds?: Record<string, number>; exclude?: string[]; user?: boolean };
  const BUILTIN_PRESETS: Preset[];
  type ChipState = Record<string, { dropped?: boolean; weight?: number }>;
  function chipsToText(tags: string[], st: ChipState): string;
  // TagOpts gains optional `groups?: number[]` (allowlist for general tags)
  ```

- [ ] **Step 1: Write the failing tests**

`studio/src/lib/blocks.test.ts`
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBlock, arcToBlocks, clusterToBlock, loadScene, outfitToBlock, slugify, themeToBlock } from "./blocks";
import { compile, emptyState, newLine } from "./prompt";

test("outfit block: union of tag lists, emphasized tags weighted", () => {
  const b = outfitToBlock("black-peplum", {
    name: "Black Peplum", tags: { tops: ["frilled shirt", "see-through"], legwear: ["white thighhighs"], materials: ["see-through"] },
    weight_overrides: { emphasized: ["white thighhighs"] },
  });
  assert.equal(b.id, "outfit:black-peplum");
  assert.deepEqual(b.char, ["frilled shirt", "see-through", "1.15::white thighhighs::"]);
});

test("theme block: effects to base, anchors+support to character, negatives to uc", () => {
  const b = themeToBlock("armor-break", {
    name: "Armor Break", base_layer: { effects: ["sparks", "debris"] },
    character_layer: { anchors: ["torn clothes"], support: ["armor"] },
    clean_cut_negatives: ["tattered"], safety_negatives: ["blood"], applies_to: "single-figure",
  });
  assert.deepEqual([b.base, b.char, b.uc], [["sparks", "debris"], ["torn clothes", "armor"], ["tattered", "blood"]]);
  const s = applyBlock({ ...emptyState(), rating: "off", base: [newLine("1girl")], chars: [{ id: "c", lines: [newLine("girl")], uc: "", enabled: true }] }, b, 0);
  const c = compile(s);
  assert.equal(c.base, "1girl, sparks, debris");
  assert.equal(c.chars[0].prompt, "girl, torn clothes, armor");
  assert.match(c.uc, /tattered, blood$/);
});

test("arc scenes become loadable blocks", () => {
  const [s1] = arcToBlocks("maru", { name: "Maru", scenes: [{ scene_number: 1, title: "Pole", prompt: { base: "1girl, 0.9::race track::", character: "girl, smile", undesired: "lowres" } }] });
  assert.equal(s1.name, "Maru · 1 Pole");
  const st = loadScene(s1);
  assert.deepEqual(st.base.map((l) => [l.text, l.weight]), [["1girl", undefined], ["race track", 0.9]]);
  assert.equal(st.chars.length, 1);
  assert.equal(st.uc, "lowres");
  assert.equal(st.positions, "ai");
});

test("cluster block keeps kind and sends to the chosen target", () => {
  const b = clusterToBlock("maid-set", { name: "maid set", kind: "theme", tags: ["maid", "maid headdress"] });
  assert.equal(b.kind, "theme");
  assert.ok(b.user);
  const s = applyBlock(emptyState(), b, "base");
  assert.deepEqual(s.base.filter((l) => l.text).map((l) => l.text), ["maid, maid headdress"]);
});

test("slugify rejects traversal and empties", () => {
  assert.equal(slugify("Maid Set!"), "maid-set");
  assert.equal(slugify("../x"), "x");
  assert.equal(slugify("💀"), null);
  assert.equal(slugify("   "), null);
});
```

Append to `studio/src/lib/tagger.test.ts`:
```ts
test("chipsToText: dropped never sent, boosted weighted", async () => {
  const { chipsToText } = await import("./tagger");
  assert.equal(chipsToText(["a", "b", "c"], { b: { dropped: true }, c: { weight: 1.15 } }), "a, 1.15::c::");
});

test("presets: Outfit only keeps clothing/state groups of general tags only", async () => {
  const { BUILTIN_PRESETS } = await import("./tagger");
  const p = BUILTIN_PRESETS.find((x) => x.id === "outfit")!;
  const out = filterTags(tags, { thresholds, enabled: p.enabled, exclude: DEFAULT_EXCLUDE, groups: p.groups });
  assert.deepEqual(out, ["school uniform"]);
});
```

- [ ] **Step 2: Run to verify failure** — `cd studio && npm test 2>&1 | grep -E "^✖|Cannot find"` → `Cannot find module './blocks'`; tagger additions fail (`chipsToText is not a function`).

- [ ] **Step 3: Implement `studio/src/lib/blocks.ts`**

```ts
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
  if (b.char.length) out = applyTags(out, target, "append", b.char.join(", "));
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
```

- [ ] **Step 4: Add to `studio/src/lib/tagger.ts`**

Change `TagOpts` and the filter to honor an optional general-group allowlist:
```ts
export type TagOpts = { thresholds: Record<string, number>; enabled: Record<string, boolean>; exclude: string[]; groups?: number[] };
```
and in `filterTags`, extend the `.filter(...)` predicate with:
```ts
&& (t.category !== "general" || !o.groups || o.groups.includes(t.group ?? 6))
```
Append:
```ts
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
```

- [ ] **Step 5: Run tests** — `cd studio && npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"` → all pass. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/blocks.ts studio/src/lib/blocks.test.ts studio/src/lib/tagger.ts studio/src/lib/tagger.test.ts
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): building blocks, tag chips and tagger presets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Library + user-block storage APIs

**Files:**
- Create: `studio/src/lib/library.ts` (server-only fs layer)
- Test: `studio/src/lib/library.test.ts`
- Create: `studio/src/app/api/blocks/route.ts`
- Create: `studio/src/app/api/presets/route.ts`

**Interfaces:**
- Consumes: Task 1 converters, `slugify`, `Preset`; `DATA_DIR` (env.ts).
- Produces:
  ```ts
  function listBlocks(dataDir?: string): Block[];          // outfits, themes, arc scenes, user clusters
  function saveCluster(input: { name: string; kind: "cluster" | "theme"; tags: string[]; notes?: string }, dataDir?: string): Block;
  function listPresets(dataDir?: string): Preset[];        // builtins + user
  function savePreset(input: Omit<Preset, "id" | "user">, dataDir?: string): Preset;
  ```
  HTTP: `GET /api/blocks` → `{ blocks: Block[] }`; `POST /api/blocks` `{name, kind, tags, notes?}` → `{ block }` | 400; `GET /api/presets` → `{ presets }`; `POST /api/presets` → `{ preset }` | 400.

- [ ] **Step 1: Write the failing test** — `studio/src/lib/library.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBlocks, listPresets, saveCluster, savePreset } from "./library";

function tmpData() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lib-"));
  fs.mkdirSync(path.join(d, "outfits"));
  fs.writeFileSync(path.join(d, "outfits", "a.yaml"), "name: A\ntags:\n  tops: [shirt]\n");
  fs.writeFileSync(path.join(d, "outfits", "broken.yaml"), "name: [unclosed\n");
  return d;
}

test("lists outfits, skips broken YAML, includes saved clusters", () => {
  const d = tmpData();
  saveCluster({ name: "Maid Set", kind: "theme", tags: ["maid", " ", "maid headdress"] }, d);
  const ids = listBlocks(d).map((b) => b.id).sort();
  assert.deepEqual(ids, ["cluster:maid-set", "outfit:a"]);
  assert.deepEqual(listBlocks(d).find((b) => b.id === "cluster:maid-set")!.char, ["maid", "maid headdress"]);
});

test("hostile names stay inside data/clusters; bad input rejected", () => {
  const d = tmpData();
  saveCluster({ name: "../../escape", kind: "cluster", tags: ["x"] }, d);
  assert.ok(fs.existsSync(path.join(d, "clusters", "escape.yaml")));
  assert.ok(!fs.existsSync(path.join(d, "..", "escape.yaml")));
  assert.throws(() => saveCluster({ name: "💀", kind: "cluster", tags: ["x"] }, d), /name/i);
  assert.throws(() => saveCluster({ name: "ok", kind: "cluster", tags: [] }, d), /tag/i);
});

test("presets = builtins + saved", () => {
  const d = tmpData();
  savePreset({ name: "Faces", enabled: { character: true, general: true }, groups: [0, 1] }, d);
  const ids = listPresets(d).map((p) => p.id);
  assert.deepEqual(ids, ["full", "outfit", "char-artist", "faces"]);
});
```

- [ ] **Step 2: Run to verify failure** — `cd studio && npx tsx --test src/lib/library.test.ts` → `Cannot find module './library'`.

- [ ] **Step 3: Implement `studio/src/lib/library.ts`** (no `server-only` import so node:test can load it; only API routes import it)

```ts
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

export function listPresets(dataDir = DATA_DIR): Preset[] {
  const user = readDir(path.join(dataDir, "presets")).map(([s, d]) => ({ ...(d as Omit<Preset, "id">), id: s, user: true }));
  return [...BUILTIN_PRESETS, ...user];
}

export function savePreset(input: Omit<Preset, "id" | "user">, dataDir = DATA_DIR): Preset {
  const slug = slugify(String(input.name ?? ""));
  if (!slug || BUILTIN_PRESETS.some((p) => p.id === slug)) throw new Error("Give the preset a new name with letters or numbers.");
  const doc = { name: input.name.trim(), enabled: input.enabled ?? {}, groups: input.groups, thresholds: input.thresholds, exclude: input.exclude };
  writeAtomic(path.join(dataDir, "presets", `${slug}.yaml`), stringify(JSON.parse(JSON.stringify(doc))));
  return { ...doc, id: slug, user: true };
}
```

- [ ] **Step 4: Run test** — PASS (3).

- [ ] **Step 5: Routes**

`studio/src/app/api/blocks/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { listBlocks, saveCluster } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ blocks: listBlocks() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ block: saveCluster(body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

`studio/src/app/api/presets/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { listPresets, savePreset } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ presets: listPresets() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ preset: savePreset(body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Live check** (localhost-only dev server, gate off)

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && npm run typecheck && (APP_PASSWORD= npx next dev -H 127.0.0.1 -p 3100 > /tmp/studio.log 2>&1 &) ; sleep 8
curl -s 127.0.0.1:3100/api/blocks | python3 -c "import json,sys;print([(b['id'],len(b['base']),len(b['char']),len(b['uc'])) for b in json.load(sys.stdin)['blocks']])"
curl -s 127.0.0.1:3100/api/presets | python3 -c "import json,sys;print([p['id'] for p in json.load(sys.stdin)['presets']])"
curl -s -X POST 127.0.0.1:3100/api/blocks -H 'Content-Type: application/json' -d '{"name":"","kind":"cluster","tags":["x"]}' -w " %{http_code}\n"
pkill -f "next dev -H 127.0.0.1 -p 3100"
```
Expected: blocks include `theme:armor-break`, `theme:clothing-slash`, `outfit:black-peplum-bottomless` and four `scene:maruzensky-racing-cut#N`; theme blocks have non-zero base and char counts; presets `['full','outfit','char-artist']`; empty name → 400.

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/library.ts studio/src/lib/library.test.ts studio/src/app/api/blocks studio/src/app/api/presets
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): library blocks and user cluster/preset storage APIs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tagger pane with chips and touch drag

**Files:**
- Create: `studio/src/components/TaggerPane.tsx`
- Create: `studio/src/components/TagChip.tsx`

**Interfaces:**
- Consumes: `/api/tag` (Plan 2); `filterTags`, `chipsToText`, `DEFAULT_ENABLED`, `DEFAULT_EXCLUDE`, `RawTag`, `ChipState`, `Preset` (Task 1); `requestJson`.
- Produces:
  ```tsx
  <TaggerPane
    preset={Preset} onTagged={(n: number) => void}
    onDrop={(text: string, target: "base" | number | "new") => void}
    onRecipe={(r: { state: PromptState; params: Partial<NaiParams> }) => void}
    onText={(text: string) => void} />          // current kept-chip text, for the drawer's Send
  ```
  Drop targets are any element with `data-drop="base" | "char:<i>" | "new"`; the pane finds them with `document.elementFromPoint`.

- [ ] **Step 1: `studio/src/components/TagChip.tsx`** — tap = drop/undrop, hold 450 ms = boost 1.15 toggle, move > 8 px = drag

```tsx
"use client";
import { useRef } from "react";

type Props = {
  tag: string; dropped: boolean; weight?: number;
  onToggle: () => void; onBoost: () => void;
  onDragMove: (x: number, y: number) => void; onDragEnd: (x: number, y: number) => void;
};

export function TagChip({ tag, dropped, weight, onToggle, onBoost, onDragMove, onDragEnd }: Props) {
  const start = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout>; mode: "tap" | "drag" | "held" } | null>(null);

  return (
    <button
      type="button"
      aria-pressed={!dropped}
      aria-label={`${tag}${weight ? ` weight ${weight}` : ""}${dropped ? ", dropped" : ""}`}
      className={`touch-none select-none rounded-md border px-2.5 py-1.5 text-sm ${
        dropped ? "border-border text-muted border-dashed line-through" : weight ? "border-accent bg-surface-2" : "border-border bg-surface"
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const t = setTimeout(() => { if (start.current?.mode === "tap") { start.current.mode = "held"; onBoost(); } }, 450);
        start.current = { x: e.clientX, y: e.clientY, t, mode: "tap" };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (s.mode === "tap" && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) { clearTimeout(s.t); s.mode = "drag"; }
        if (s.mode === "drag") onDragMove(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        clearTimeout(s.t);
        if (s.mode === "tap") onToggle();
        if (s.mode === "drag") onDragEnd(e.clientX, e.clientY);
      }}
      onPointerCancel={() => { if (start.current) clearTimeout(start.current.t); start.current = null; onDragEnd(-1, -1); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {tag}
      {weight ? <b className="text-accent ml-1 text-xs">{weight}</b> : null}
    </button>
  );
}
```

- [ ] **Step 2: `studio/src/components/TaggerPane.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import type { PromptState } from "@/lib/prompt";
import { chipsToText, DEFAULT_EXCLUDE, filterTags, type ChipState, type Preset, type RawTag } from "@/lib/tagger";
import { TagChip } from "./TagChip";

type TagResponse = { tags: RawTag[]; thresholds: Record<string, number>; ms: number; recipe: null | { state: PromptState; params: Partial<NaiParams> } };
type Target = "base" | number | "new";

function targetAt(x: number, y: number): { el: HTMLElement; target: Target } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const v = el.dataset.drop!;
  return { el, target: v === "base" || v === "new" ? v : Number(v.split(":")[1]) };
}

export function TaggerPane({ preset, onTagged, onDrop, onRecipe, onText }: {
  preset: Preset; onTagged: (n: number) => void;
  onDrop: (text: string, target: Target) => void;
  onRecipe: (r: { state: PromptState; params: Partial<NaiParams> }) => void;
  onText: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<TagResponse | null>(null);
  const [chips, setChips] = useState<ChipState>({});
  const [view, setView] = useState<"chips" | "text">("chips");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ tag: string; x: number; y: number } | null>(null);
  const hover = useRef<HTMLElement | null>(null);
  const latest = useRef(0);

  const tags = useMemo(() => (res ? filterTags(res.tags, {
    thresholds: { ...res.thresholds, ...preset.thresholds },
    enabled: preset.enabled, exclude: preset.exclude ?? DEFAULT_EXCLUDE, groups: preset.groups,
  }) : []), [res, preset]);
  const text = chipsToText(tags, chips);
  useEffect(() => { onText(text); }, [text, onText]);

  async function analyze(file: File) {
    const id = ++latest.current;
    setPreview(URL.createObjectURL(file)); setBusy(true); setError(null); setRes(null); setChips({}); setOpen(true);
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<TagResponse>("/api/tag", { method: "POST", body: fd });
    if (id !== latest.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRes(r.data);
    onTagged(r.data.tags.length);
  }

  const setHover = (el: HTMLElement | null) => {
    if (hover.current === el) return;
    hover.current?.removeAttribute("data-drop-hover");
    el?.setAttribute("data-drop-hover", "");
    hover.current = el;
  };

  return (
    <section aria-label="Tagger" className="bg-surface border-border rounded-lg border">
      <header className="flex items-center gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="Image being tagged" className="h-16 w-12 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Tagger</h2>
          <p className="text-muted truncate text-xs" role="status">
            {busy ? "Analyzing…" : res ? `${tags.length} tags · ${res.ms} ms · drag onto the prompt` : "Add an image to tag it"}
          </p>
        </div>
        <label className="border-border cursor-pointer rounded-md border px-3 py-2 text-sm">
          {preview ? "New image" : "Add image"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analyze(f); }} />
        </label>
        <button type="button" aria-expanded={open} aria-label={open ? "Collapse tagger" : "Expand tagger"} onClick={() => setOpen(!open)}
          className="border-border size-11 rounded-md border">{open ? "–" : "+"}</button>
      </header>

      {open && (
        <div className="border-border space-y-3 border-t p-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyze(f); }}>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {res?.recipe && (
            <button type="button" className="text-accent text-sm" onClick={() => onRecipe(res.recipe!)}>NovelAI recipe found · load it</button>
          )}
          {res && (
            <div role="radiogroup" aria-label="Result view" className="border-border inline-flex overflow-hidden rounded-md border text-xs">
              {(["chips", "text"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 capitalize ${view === v ? "bg-surface-2 text-fg" : "text-muted"}`}>{v}</button>
              ))}
            </div>
          )}
          {res && view === "chips" && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <TagChip key={t} tag={t} dropped={!!chips[t]?.dropped} weight={chips[t]?.weight}
                  onToggle={() => setChips({ ...chips, [t]: { ...chips[t], dropped: !chips[t]?.dropped } })}
                  onBoost={() => setChips({ ...chips, [t]: { ...chips[t], dropped: false, weight: chips[t]?.weight ? undefined : 1.15 } })}
                  onDragMove={(x, y) => { setGhost({ tag: t, x, y }); setHover(targetAt(x, y)?.el ?? null); }}
                  onDragEnd={(x, y) => {
                    setGhost(null); setHover(null);
                    const hit = targetAt(x, y);
                    if (hit) onDrop(chips[t]?.weight ? `${chips[t].weight}::${t}::` : t, hit.target);
                  }} />
              ))}
            </div>
          )}
          {res && view === "text" && <textarea readOnly value={text} rows={5} aria-label="Kept tags" className="bg-bg border-border w-full rounded-md border p-2 text-base" />}
          {res && (
            <div className="flex gap-2">
              <button type="button" data-drop="base" onClick={() => onDrop(text, "base")} disabled={!text}
                className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm disabled:opacity-40">All → Base</button>
              <button type="button" data-drop="new" onClick={() => onDrop(text, "new")} disabled={!text}
                className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm disabled:opacity-40">All → new character</button>
            </div>
          )}
        </div>
      )}

      {ghost && (
        <span aria-hidden="true" className="bg-surface-2 border-accent pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-md border px-2.5 py-1.5 text-sm shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}>{ghost.tag}</span>
      )}
    </section>
  );
}
```

Add to `studio/src/app/globals.css`:
```css
/* Drop target highlight while a tag chip is dragged over it. */
[data-drop-hover] { outline: 2px dashed var(--color-accent); outline-offset: 2px; }
```

- [ ] **Step 3: Typecheck** — `cd studio && npm run typecheck` → clean (components not mounted yet; Task 4 wires them).

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/TagChip.tsx studio/src/components/TaggerPane.tsx studio/src/app/globals.css
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): tagger pane with tag chips and touch drag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Block drawer, Studio wiring, retire `/tagger`

**Files:**
- Create: `studio/src/components/BlockDrawer.tsx`
- Modify: `studio/src/app/page.tsx` (mount pane + drawer, drop handling)
- Modify: `studio/src/components/LineList.tsx` — no change; the Base wrapper in page.tsx gets `data-drop="base"`
- Modify: `studio/src/components/CharacterBoxes.tsx` (each character `<section>` gets `data-drop={\`char:${i}\`}`)
- Delete: `studio/src/app/tagger/page.tsx`, `studio/src/components/NavTabs.tsx`
- Modify: `studio/src/app/layout.tsx` (remove `NavTabs`)

**Interfaces:**
- Consumes: `/api/blocks`, `/api/presets` (Task 2); `applyBlock`, `loadScene`, `Block` (Task 1); `applyTags` (prompt.ts); `TaggerPane` (Task 3); `BUILTIN_PRESETS`, `Preset` (Task 1).
- Produces:
  ```tsx
  <BlockDrawer open onClose chars={CharBox[]} tagText={string}
    onSend={(picked: Block[], target: "base" | number) => void}
    onLoadScene={(b: Block) => void}
    preset={Preset} onPreset={(p: Preset) => void} />
  ```

- [ ] **Step 1: `studio/src/components/BlockDrawer.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { Block } from "@/lib/blocks";
import { requestJson } from "@/lib/net";
import type { CharBox } from "@/lib/prompt";
import { BUILTIN_PRESETS, type Preset } from "@/lib/tagger";

const DOT = ["#b7a4ff", "#5fd4e6", "#ffb86b", "#7ee0a1"];

export function BlockDrawer({ open, onClose, chars, tagText, onSend, onLoadScene, preset, onPreset }: {
  open: boolean; onClose: () => void; chars: CharBox[]; tagText: string;
  onSend: (picked: Block[], target: "base" | number) => void; onLoadScene: (b: Block) => void;
  preset: Preset; onPreset: (p: Preset) => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [presets, setPresets] = useState<Preset[]>(BUILTIN_PRESETS);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<"base" | number>(chars.length ? 0 : "base");
  const [q, setQ] = useState("");
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    requestJson<{ blocks: Block[] }>("/api/blocks").then((r) => r.ok && setBlocks(r.data.blocks));
    requestJson<{ presets: Preset[] }>("/api/presets").then((r) => r.ok && setPresets(r.data.presets));
  }, [open]);

  if (!open) return null;
  const match = (b: Block) => !q || `${b.name} ${b.char.join(" ")}`.toLowerCase().includes(q.toLowerCase());
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  const chosen = blocks.filter((b) => picked.includes(b.id));
  const count = (tagText ? tagText.split(", ").length : 0) + chosen.reduce((n, b) => n + b.char.length + b.base.length, 0);

  async function saveCluster() {
    const r = await requestJson<{ block: Block }>("/api/blocks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: saveName, kind: "cluster", tags: tagText.split(", ").filter(Boolean) }),
    });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setSaveName("");
    setBlocks([...blocks.filter((b) => b.id !== r.data.block.id), r.data.block]);
  }

  const card = (b: Block) => (
    <button key={b.id} type="button" aria-pressed={picked.includes(b.id)} onClick={() => toggle(b.id)}
      className={`rounded-lg border p-2.5 text-left ${picked.includes(b.id) ? "border-accent bg-surface-2" : "border-border bg-bg"}`}>
      <div className="text-sm font-semibold">{b.name}</div>
      <div className="text-muted mt-0.5 truncate text-xs">{[...b.base, ...b.char].slice(0, 4).join(", ")} · {b.base.length + b.char.length}</div>
    </button>
  );
  const section = (title: string, children: React.ReactNode) => (
    <div><h3 className="text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">{title}</h3>{children}</div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-label="Add to this scene">
      <button type="button" aria-label="Close drawer" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <section className="bg-surface border-border relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border-t lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-l">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h2 className="font-semibold">Add to this scene</h2>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks" aria-label="Search blocks"
            className="bg-bg border-border ml-auto w-36 rounded-md border px-2 py-1.5 text-base" />
          <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 rounded-md border">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {section("Tagger presets", (
            <div role="radiogroup" aria-label="Tagger preset" className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={preset.id === p.id} onClick={() => onPreset(p)}
                  className={`rounded-full px-3 py-2 text-sm ${preset.id === p.id ? "bg-accent text-accent-fg font-semibold" : "border-border border"}`}>{p.name}</button>
              ))}
            </div>
          ))}
          {section("Theme groups", <div className="grid grid-cols-2 gap-2">{blocks.filter((b) => b.kind === "theme" && match(b)).map(card)}</div>)}
          {section("My clusters", (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">{blocks.filter((b) => b.kind === "cluster" && match(b)).map(card)}</div>
              {tagText && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveCluster(); }}>
                  <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Save current tags as…" aria-label="Cluster name"
                    className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
                  <button type="submit" disabled={!saveName.trim()} className="text-accent px-2 text-sm disabled:opacity-40">Save</button>
                </form>
              )}
              {error && <p role="alert" className="text-danger text-sm">{error}</p>}
            </div>
          ))}
          {section("Library", (
            <div className="space-y-1.5">
              {blocks.filter((b) => (b.kind === "outfit" || b.kind === "scene") && match(b)).map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <div className="flex-1">{card(b)}</div>
                  {b.kind === "scene" && <button type="button" onClick={() => onLoadScene(b)} className="text-accent px-2 py-2 text-sm">Load</button>}
                </div>
              ))}
            </div>
          ))}
          {section("Suggested for this image", <p className="text-muted text-sm">Available when the co-pilot is on.</p>)}
        </div>

        <div className="border-border flex gap-2 border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <select aria-label="Send to" value={String(target)} onChange={(e) => setTarget(e.target.value === "base" ? "base" : Number(e.target.value))}
            className="bg-bg border-border rounded-md border px-2 py-3 text-base">
            <option value="base">Base</option>
            {chars.map((c, i) => <option key={c.id} value={i}>Character {i + 1}</option>)}
          </select>
          {typeof target === "number" && <span aria-hidden="true" className="my-auto size-3 rounded-full" style={{ background: DOT[target % DOT.length] }} />}
          <button type="button" disabled={!count} onClick={() => { onSend(chosen, target); setPicked([]); onClose(); }}
            className="bg-accent text-accent-fg ml-auto flex-1 rounded-lg px-4 py-3 font-semibold disabled:opacity-40">Send {count} tags</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `studio/src/app/page.tsx`**

Add imports:
```tsx
import { BlockDrawer } from "@/components/BlockDrawer";
import { TaggerPane } from "@/components/TaggerPane";
import { applyBlock, loadScene, type Block } from "@/lib/blocks";
import { applyTags } from "@/lib/prompt";
import { BUILTIN_PRESETS, type Preset } from "@/lib/tagger";
```
Add state inside `Studio()` (after `loaded`):
```tsx
  const [drawer, setDrawer] = useState(false);
  const [preset, setPreset] = useState<Preset>(BUILTIN_PRESETS[0]);
  const [tagText, setTagText] = useState("");

  function dropTags(text: string, target: "base" | number | "new") {
    if (!text) return;
    setState((s) => applyTags(s, target === "new" ? s.chars.length : target, "append", text));
  }

  function sendBlocks(picked: Block[], target: "base" | number) {
    setState((s) => picked.reduce((acc, b) => applyBlock(acc, b, target), tagText ? applyTags(s, target, "append", tagText) : s));
  }
```
In the left `<section className="space-y-4">`, insert first (before `<ParamsBar …>`):
```tsx
        <TaggerPane preset={preset} onTagged={() => setDrawer(true)} onDrop={dropTags}
          onRecipe={(r) => reuse({ state: r.state, params: { ...params, ...r.params } })} onText={setTagText} />
        <button type="button" onClick={() => setDrawer(true)} className="border-border w-full rounded-md border px-3 py-2.5 text-sm">
          Building blocks — presets, themes, clusters, library
        </button>
```
Give the base wrapper a drop target: change `<div className="bg-surface border-border rounded-lg border p-3">` (the one containing "Base prompt") to `<div data-drop="base" className="bg-surface border-border rounded-lg border p-3">`.
Mount the drawer just before the closing `</main>`:
```tsx
      <BlockDrawer open={drawer} onClose={() => setDrawer(false)} chars={state.chars} tagText={tagText}
        onSend={sendBlocks} onLoadScene={(b) => { setState(loadScene(b)); setDrawer(false); }}
        preset={preset} onPreset={setPreset} />
```
`onText={setTagText}` must be stable for the pane's effect — `useState` setters are, so no `useCallback` is needed.

- [ ] **Step 3: Drop targets on character boxes** — in `studio/src/components/CharacterBoxes.tsx` change the per-character `<section key={c.id} className="bg-surface border-border rounded-lg border p-3">` to `<section key={c.id} data-drop={`char:${i}`} className="bg-surface border-border rounded-lg border p-3">`.

- [ ] **Step 4: Retire the old tab** — delete `studio/src/app/tagger/page.tsx` and `studio/src/components/NavTabs.tsx`; in `studio/src/app/layout.tsx` remove the `NavTabs` import and `<NavTabs />` line.

- [ ] **Step 5: Typecheck + suite** — `cd studio && npm run typecheck && npm test 2>&1 | grep -E "ℹ (pass|fail)"` → clean, all pass.

- [ ] **Step 6: Browser check** (`npm run tagger` running; dev server localhost-only, gate off; phone width via 390 px same-origin iframe; long waits done as short polls, each JS call < 40 s)

1. `/` at 390 px: Tagger pane on top, no horizontal scroll; `/tagger` now 404.
2. Drop the newest gallery PNG on the pane → chips appear, drawer opens automatically.
3. In the drawer: pick preset "Outfit only" → pane chips shrink to clothing tags; pick theme "Armor Break" + Library "Black Peplum Bottomless"; target Character 1; Send → base gains `sparks…` effects, Character 1 gains chip tags + armor + outfit tags, UC gains `tattered…`.
4. Real mouse drag (`left_click_drag`) of one chip onto Character 2's box → that tag appended to Character 2; the page did not scroll during drag; a plain click on a chip toggles it struck-through (no drag).
5. Hold a chip ~0.6 s (mouse down, wait, up) → chip shows `1.15`; Text view shows `1.15::tag::`.
6. Save current tags as cluster "test cluster" → appears under My clusters; file `data/clusters/test-cluster.yaml` exists (delete it after the check).
7. Library → Maruzensky scene 2 → Load → editor shows that scene's base/character/UC.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/BlockDrawer.tsx studio/src/app/page.tsx studio/src/components/CharacterBoxes.tsx studio/src/app/layout.tsx
git rm -q studio/src/app/tagger/page.tsx studio/src/components/NavTabs.tsx
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): split-desk tagger with building-block drawer; retire tagger tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

- Strength grid (spec §4.3) as its own small plan.
- Plan 4 Chat co-pilot fills "Suggested for this image" (TIPO expand + brain), then design challenge 3.
- `ponytail:` the desk pane collapses/expands rather than drag-resizing; add a resize handle if the fixed split proves cramped on the phone.
