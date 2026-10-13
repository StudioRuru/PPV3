# NAI V5 Studio — Plan 2: Tagger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop or upload any image (from the phone too), get PixAI tags grouped by category with live threshold sliders, and send them into the Studio's base prompt or a character box with replace/append. If the image is a NovelAI PNG, offer its recipe too.

**Architecture:** A small Python FastAPI sidecar (`NAIPromptAgentV2/tagger/`, port 8190) runs `pixai-labs/pixai-tagger-v1.0` on MPS and returns every tag scoring above 0.05 with its category. The Next.js route `/api/tag` proxies the upload, adds a YAML-derived sort group to each tag, and attaches any NovelAI recipe. All filtering (sliders, category toggles, exclude list) runs client-side in a pure, tested `filterTags`, so the sliders never re-run the model. Sending to the Studio goes through the existing localStorage draft.

**Tech Stack:** Python 3.12 via `uv`, FastAPI, uvicorn, transformers 4.57.6, torch/torchvision (MPS), timm, Pillow, pytest; existing Next.js 16 app.

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` (§4.4 Tagger, §5, §6; phase 3)

## Global Constraints

- Repo root `/Users/rurudayo/ClaudeCode/NAIPromptAgentV2`; enclosing git repo is the home dir. Commit with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit …`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only named files.
- Model: `pixai-labs/pixai-tagger-v1.0` (Apache-2.0, ~2 GB, 1008 px input). Its default thresholds: general 0.17, character 0.27, style 0.15, copyright 0.24, meta 0.17, rating 0.41.
- **Spec deviation (needs user OK at plan review):** PixAI's `style` category *is* artist detection (4,917 artists, style micro-F1 0.81 vs Camie v2's 0.38), so the Camie v2 artist pass from spec §4.4 is dropped. `style` tags are emitted as `artist:<name>`. Lost: Camie's `year` tags.
- Sidecar listens on `127.0.0.1:8190` only; the Next app reaches it via `TAGGER_URL` (default `http://127.0.0.1:8190`).
- NAI tag form: spaces not underscores, no backslash escapes, artists as `artist:name`.
- Sidecar-down must show a readable banner, never a 500.

## Review Focus

1. **Phone photos** (EXIF-rotated JPEGs from iOS Safari) must be tagged upright. → `exif_transpose` in Task 1, checked in the smoke step.
2. **Non-image upload** (PDF, text, empty file) must return 422 "Not a readable image", not crash the sidecar. → test in Task 1.
3. **Sidecar not running** → `/api/tag` returns 503 with "Tagger offline — run `npm run tagger`", and the page shows it. → route check in Task 3.
4. **Send to a character that doesn't exist yet** (Character 3 when there are 2) must create it, not throw. → test in Task 2.
5. **Excluded tags and disabled categories must never leak into sent text**, including artist tags when Style is off. → test in Task 2.

---

### Task 1: PixAI tagger sidecar

**Files:**
- Create: `tagger/pyproject.toml`, `tagger/tagger.py`, `tagger/test_tagger.py`, `tagger/.gitignore`

**Interfaces:**
- Produces (HTTP, `127.0.0.1:8190`):
  - `GET /health` → `{"ok": true, "loaded": bool}`
  - `POST /tag` multipart `file` → `{"tags": [{"name": str, "category": "general"|"character"|"copyright"|"style"|"meta"|"rating", "score": float}], "thresholds": {category: float}, "ms": int}`; 422 `{"detail": "Not a readable image."}`
- Produces (Python): `flatten(results: dict[str, dict[str, float]]) -> list[dict]`, `load_image(data: bytes) -> PIL.Image.Image`

- [ ] **Step 1: Project files**

`tagger/pyproject.toml`
```toml
[project]
name = "nai-tagger"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn>=0.32",
  "python-multipart>=0.0.20",
  "pillow>=11",
  "torch>=2.8",
  "torchvision>=0.23",
  "transformers==4.57.6",
  "timm>=1.0",
]

[dependency-groups]
dev = ["pytest>=8"]
```

`tagger/.gitignore`
```
.venv/
__pycache__/
.pytest_cache/
```

- [ ] **Step 2: Write the failing test** — `tagger/test_tagger.py`

```python
import io

import pytest
from PIL import Image

from tagger import flatten, load_image


def test_flatten_sorts_by_score_and_keeps_category():
    out = flatten({"general": {"1girl": 0.99, "smile": 0.5}, "style": {"bkub": 0.7}})
    assert [t["name"] for t in out] == ["1girl", "bkub", "smile"]
    assert out[1] == {"name": "bkub", "category": "style", "score": 0.7}


def test_load_image_applies_exif_rotation():
    img = Image.new("RGB", (40, 20))
    exif = Image.Exif()
    exif[0x0112] = 6  # orientation: rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    assert load_image(buf.getvalue()).size == (20, 40)


@pytest.mark.parametrize("data", [b"", b"%PDF-1.7 not an image"])
def test_load_image_rejects_non_images(data):
    with pytest.raises(ValueError, match="Not a readable image"):
        load_image(data)
```

- [ ] **Step 3: Run to verify failure**

Run: `cd tagger && uv run --group dev pytest -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'tagger'` (uv creates `.venv` and installs deps first; torch is large, allow several minutes).

- [ ] **Step 4: Implement `tagger/tagger.py`**

```python
"""PixAI Tagger v1.0 sidecar.

POST /tag (multipart `file`) -> every tag scoring above MIN_SCORE, with its category, so the
client can filter with sliders without re-running the model. Categories: general, character,
copyright, style (= artists), meta, rating.
"""
import io
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

MODEL_ID = "pixai-labs/pixai-tagger-v1.0"
MIN_SCORE = float(os.environ.get("TAGGER_MIN_SCORE", "0.05"))

_pipe = None


def flatten(results: dict[str, dict[str, float]]) -> list[dict]:
    """Pipeline output {category: {tag: score}} -> [{name, category, score}], best first."""
    out = [
        {"name": name, "category": cat, "score": round(score, 4)}
        for cat, tags in results.items()
        for name, score in tags.items()
    ]
    return sorted(out, key=lambda t: -t["score"])


def load_image(data: bytes) -> Image.Image:
    """Decode upload bytes; apply EXIF rotation (iPhone photos arrive sideways otherwise)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("Not a readable image.") from e
    return ImageOps.exif_transpose(img)


def load_pipe():
    global _pipe
    if _pipe is None:
        import torch
        from transformers import pipeline

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _pipe = pipeline(model=MODEL_ID, image_processor=MODEL_ID, trust_remote_code=True, device=device)
    return _pipe


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("TAGGER_PRELOAD", "1") == "1":
        load_pipe()  # ~10 s once; first /tag is then fast
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "loaded": _pipe is not None}


@app.post("/tag")
async def tag(file: UploadFile = File(...)):
    try:
        img = load_image(await file.read())
    except ValueError as e:
        raise HTTPException(422, str(e))
    t = time.perf_counter()
    pipe = load_pipe()
    results = pipe(img, threshold=MIN_SCORE)["results"]
    return {
        "tags": flatten(results),
        "thresholds": pipe.model.config.category_best_threshold,
        "ms": round((time.perf_counter() - t) * 1000),
    }
```

- [ ] **Step 5: Run tests**

Run: `cd tagger && uv run --group dev pytest -q`
Expected: 4 passed.

- [ ] **Step 6: Smoke test against the real model** (downloads ~2 GB once to `~/.cache/huggingface`)

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/tagger && (uv run uvicorn tagger:app --host 127.0.0.1 --port 8190 > /tmp/tagger.log 2>&1 &)
until curl -sf 127.0.0.1:8190/health | grep -q '"loaded":true'; do sleep 5; done
F=$(ls -t ../data/gallery/*.png | head -1)
curl -s -F "file=@$F" 127.0.0.1:8190/tag | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['ms'],'ms');print([(t['name'],t['category'],t['score']) for t in d['tags'][:12]])"
curl -s -F "file=@tagger.py" 127.0.0.1:8190/tag -w " %{http_code}\n"
```
Expected: tags include `2girls`/`red_hair`/`blue_hair`/`outdoors`-style general tags and at least one `rating:*`; `ms` well under 5000 after warm-up; the `.py` upload returns 422. Leave the server running for Task 3.

- [ ] **Step 7: Commit**

```bash
git add tagger/pyproject.toml tagger/uv.lock tagger/tagger.py tagger/test_tagger.py tagger/.gitignore
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(tagger): PixAI v1.0 tagging sidecar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tag filtering + send-to-Studio logic

**Files:**
- Create: `studio/src/lib/tagger.ts`
- Test: `studio/src/lib/tagger.test.ts`
- Modify: `studio/src/lib/prompt.ts` (add `applyTags`)
- Modify: `studio/src/lib/prompt.test.ts`
- Create: `studio/src/lib/draft.ts`

**Interfaces:**
- Consumes: `PromptState`, `newLine`, `emptyState` (Plan 1).
- Produces:
  ```ts
  type RawTag = { name: string; category: string; score: number; group?: number };
  type TagOpts = { thresholds: Record<string, number>; enabled: Record<string, boolean>; exclude: string[] };
  const DEFAULT_ENABLED: Record<string, boolean>;   // meta + rating off
  const DEFAULT_EXCLUDE: string[];
  function toPromptTag(t: RawTag): string;           // spaces, artist: prefix for style
  function filterTags(tags: RawTag[], o: TagOpts): string[];
  function applyTags(s: PromptState, target: "base" | number, mode: "replace" | "append", text: string): PromptState;  // in prompt.ts
  const DRAFT_KEY = "studio-draft-v1";
  function loadDraft(): { state: PromptState; params: NaiParams } | null;   // draft.ts (try/catch localStorage)
  function saveDraft(d: { state: PromptState; params: NaiParams }): void;
  ```

- [ ] **Step 1: Write the failing tests**

`studio/src/lib/tagger.test.ts`
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ENABLED, DEFAULT_EXCLUDE, filterTags, toPromptTag, type RawTag } from "./tagger";

const tags: RawTag[] = [
  { name: "smile", category: "general", score: 0.9, group: 6 },
  { name: "1girl", category: "general", score: 0.99, group: 0 },
  { name: "red_hair", category: "general", score: 0.95, group: 1 },
  { name: "school_uniform", category: "general", score: 0.6, group: 2 },
  { name: "faint_tag", category: "general", score: 0.1, group: 6 },
  { name: "watermark", category: "general", score: 0.8, group: 6 },
  { name: "king_halo_(umamusume)", category: "character", score: 0.9 },
  { name: "umamusume", category: "copyright", score: 0.9 },
  { name: "ebifurya", category: "style", score: 0.5 },
  { name: "highres", category: "meta", score: 0.9 },
  { name: "rating:s", category: "rating", score: 0.8 },
];
const thresholds = { general: 0.17, character: 0.27, style: 0.15, copyright: 0.24, meta: 0.17, rating: 0.41 };

test("prompt form: spaces, parens kept, artists prefixed", () => {
  assert.equal(toPromptTag({ name: "king_halo_(umamusume)", category: "character", score: 1 }), "king halo (umamusume)");
  assert.equal(toPromptTag({ name: "ebifurya", category: "style", score: 1 }), "artist:ebifurya");
});

test("default filter: order character, copyright, general by group, then artists; meta/rating/excluded/below-threshold dropped", () => {
  const out = filterTags(tags, { thresholds, enabled: DEFAULT_ENABLED, exclude: DEFAULT_EXCLUDE });
  assert.deepEqual(out, ["king halo (umamusume)", "umamusume", "1girl", "red hair", "school uniform", "smile", "artist:ebifurya"]);
});

test("disabled category never leaks, incl. artists", () => {
  const out = filterTags(tags, { thresholds, enabled: { ...DEFAULT_ENABLED, style: false, character: false }, exclude: [] });
  assert.ok(!out.some((t) => t.startsWith("artist:") || t.includes("king halo")));
  assert.ok(out.includes("watermark"), "exclude list emptied → watermark allowed");
});

test("raising a slider drops lower-scoring tags", () => {
  const out = filterTags(tags, { thresholds: { ...thresholds, general: 0.92 }, enabled: DEFAULT_ENABLED, exclude: DEFAULT_EXCLUDE });
  assert.deepEqual(out.filter((t) => !t.includes("(") && !t.includes(":") && t !== "umamusume"), ["1girl", "red hair"]);
});
```

Append to `studio/src/lib/prompt.test.ts`:
```ts
test("applyTags: base replace/append and new character creation", async () => {
  const { applyTags, emptyState, newLine } = await import("./prompt");
  const s = { ...emptyState(), base: [newLine("old")] };
  assert.deepEqual(applyTags(s, "base", "replace", "1girl, smile").base.map((l) => l.text), ["1girl, smile"]);
  assert.deepEqual(applyTags(s, "base", "append", "smile").base.map((l) => l.text), ["old", "smile"]);
  const withChar = applyTags(s, 2, "append", "girl, red hair");
  assert.equal(withChar.chars.length, 3);
  assert.deepEqual(withChar.chars[2].lines.map((l) => l.text), ["girl, red hair"]);
  assert.equal(s.chars.length, 0, "input state not mutated");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npm test 2>&1 | grep -E "^✖|Cannot find"`
Expected: `Cannot find module './tagger'` and the `applyTags` test fails (`applyTags is not a function`).

- [ ] **Step 3: Implement `studio/src/lib/tagger.ts`**

```ts
export type RawTag = { name: string; category: string; score: number; group?: number };
export type TagOpts = { thresholds: Record<string, number>; enabled: Record<string, boolean>; exclude: string[] };

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
    .filter((t) => o.enabled[t.category] && t.score >= (o.thresholds[t.category] ?? 0.2) && !excluded.has(spaced(t.name).toLowerCase()))
    .sort((a, b) => rank(a.category) - rank(b.category) || (a.group ?? 99) - (b.group ?? 99) || b.score - a.score)
    .map(toPromptTag);
}
```

- [ ] **Step 4: Add `applyTags` to `studio/src/lib/prompt.ts`** (after `parseToLines`)

```ts
/** Put tag text into the base or character N (created if missing). Pure: returns a new state. */
export function applyTags(s: PromptState, target: "base" | number, mode: "replace" | "append", text: string): PromptState {
  const put = (lines: Line[]) => (mode === "replace" ? [newLine(text)] : [...lines.filter((l) => l.text.trim()), newLine(text)]);
  if (target === "base") return { ...s, base: put(s.base) };
  const chars = [...s.chars];
  while (chars.length <= target) chars.push({ id: newLine().id, lines: [], uc: "", enabled: true });
  chars[target] = { ...chars[target], lines: put(chars[target].lines) };
  return { ...s, chars };
}
```

- [ ] **Step 5: Create `studio/src/lib/draft.ts`** (shared by Studio and Tagger pages)

```ts
import type { NaiParams } from "./nai-body";
import type { PromptState } from "./prompt";

export const DRAFT_KEY = "studio-draft-v1";
export type Draft = { state: PromptState; params: NaiParams };

/** Per-device convenience only; storage can be blocked (private mode), so never throw. */
export function loadDraft(): Draft | null {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { return null; }
}

export function saveDraft(d: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}
```

In `studio/src/app/page.tsx` replace the two inline `localStorage` effects with `loadDraft()` / `saveDraft({ state, params })` and drop the local `DRAFT` constant:
```tsx
useEffect(() => {
  const d = loadDraft();
  if (d) { setState({ ...emptyState(), ...d.state }); setParams({ ...DEFAULT_PARAMS, ...d.params }); }
  loadHistory().then((items) => setCurrent(items[0] ?? null));
}, [loadHistory]);

useEffect(() => { saveDraft({ state, params }); }, [state, params]);
```
(add `import { loadDraft, saveDraft } from "@/lib/draft";`)

- [ ] **Step 6: Run tests** — `cd studio && npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"` → all pass (28). `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/tagger.ts studio/src/lib/tagger.test.ts studio/src/lib/prompt.ts studio/src/lib/prompt.test.ts studio/src/lib/draft.ts studio/src/app/page.tsx
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): tag filtering, applyTags and shared draft helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `/api/tag` proxy with YAML sort groups and recipe

**Files:**
- Modify: `studio/src/lib/tags.ts` (add `yamlGroupRank`, `GROUP_RANK`, `isSubjectTag`)
- Modify: `studio/src/lib/tags.test.ts`
- Modify: `studio/src/lib/tag-index.ts` (expose `yamlGroups()`)
- Modify: `studio/src/lib/env.ts` (add `TAGGER_URL`)
- Create: `studio/src/app/api/tag/route.ts`
- Modify: `studio/package.json` (add `tagger` script)

**Interfaces:**
- Consumes: `readRecipe`, `recipeToState` (Plan 1); `RawTag` (Task 2); sidecar `POST /tag` (Task 1).
- Produces: `POST /api/tag` multipart `file` → `200 { tags: RawTag[], thresholds, ms, recipe: null | { recipe, state, params } }` | `422 { error }` | `503 { error: "Tagger offline — run \`npm run tagger\` on the Mac." }`.
- Produces (lib): `GROUP_RANK: Record<string, number>`, `yamlGroupRank(name: string, groups: Map<string, string>): number`.

- [ ] **Step 1: Write the failing test** (append to `studio/src/lib/tags.test.ts`)

```ts
test("yaml group rank: subject first, then appearance, clothing, pose, setting, other", async () => {
  const { yamlGroupRank } = await import("./tags");
  const groups = new Map([["red hair", "appearance"], ["school uniform", "clothing"], ["standing", "poses"], ["park", "settings"]]);
  const r = (n: string) => yamlGroupRank(n, groups);
  assert.deepEqual(["1girl", "solo", "red_hair", "school_uniform", "standing", "park", "smile"].map(r), [0, 0, 1, 2, 4, 5, 6]);
});
```

- [ ] **Step 2: Run to verify failure** — `cd studio && npx tsx --test src/lib/tags.test.ts` → FAIL (`yamlGroupRank is not a function`).

- [ ] **Step 3: Implement in `studio/src/lib/tags.ts`** (append)

```ts
/** Sort rank per YAML file (tags/<file>.yaml). Lower = earlier in the prompt. */
export const GROUP_RANK: Record<string, number> = {
  appearance: 1, clothing: 2, footwear: 2, accessories: 2, materials: 2,
  states: 3, nudity: 3, poses: 4, settings: 5, scenarios: 5,
};

export function isSubjectTag(name: string): boolean {
  return /^(\d+\+?(girls?|boys?|others?)|solo|solo focus|no humans|multiple (girls|boys))$/.test(name);
}

export function yamlGroupRank(name: string, groups: Map<string, string>): number {
  const n = norm(name);
  if (isSubjectTag(n)) return 0;
  return GROUP_RANK[groups.get(n) ?? ""] ?? 6;
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Expose YAML groups in `studio/src/lib/tag-index.ts`** (append)

```ts
let groupCache: Map<string, string> | null = null;

/** tag name → YAML file stem (appearance, clothing, …) for prompt sorting. */
export function yamlGroups(): Map<string, string> {
  if (groupCache) return groupCache;
  const m = new Map<string, string>();
  for (const f of fs.readdirSync(TAGS_DIR).filter((f) => f.endsWith(".yaml"))) {
    const stem = f.replace(/\.yaml$/, "");
    for (const name of yamlTagNames(parse(fs.readFileSync(path.join(TAGS_DIR, f), "utf8")))) if (!m.has(name)) m.set(name, stem);
  }
  return (groupCache = m);
}
```

Add to `studio/src/lib/env.ts`:
```ts
export const TAGGER_URL = (process.env.TAGGER_URL || "http://127.0.0.1:8190").replace(/\/$/, "");
```

- [ ] **Step 6: Route `studio/src/app/api/tag/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { TAGGER_URL } from "@/lib/env";
import { readRecipe, recipeToState } from "@/lib/recipe";
import { yamlGroups } from "@/lib/tag-index";
import { yamlGroupRank } from "@/lib/tags";
import type { RawTag } from "@/lib/tagger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });

  const fd = new FormData();
  fd.append("file", file, "upload");
  let res: Response;
  try {
    res = await fetch(`${TAGGER_URL}/tag`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  } catch {
    return NextResponse.json({ error: "Tagger offline — run `npm run tagger` on the Mac." }, { status: 503 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data.detail ?? `Tagger error ${res.status}` }, { status: res.status === 422 ? 422 : 502 });

  const groups = yamlGroups();
  const tags: RawTag[] = data.tags.map((t: RawTag) => (t.category === "general" ? { ...t, group: yamlGroupRank(t.name, groups) } : t));
  const recipe = await readRecipe(Buffer.from(await file.arrayBuffer())).catch(() => null);
  return NextResponse.json({ tags, thresholds: data.thresholds, ms: data.ms, recipe: recipe ? { recipe, ...recipeToState(recipe) } : null });
}
```

Add to `studio/package.json` scripts:
```json
"tagger": "cd ../tagger && uv run uvicorn tagger:app --host 127.0.0.1 --port 8190"
```

- [ ] **Step 7: Live checks** (sidecar from Task 1 still running; Studio dev server localhost-only, gate off)

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && npm run typecheck && (APP_PASSWORD= npx next dev -H 127.0.0.1 -p 3100 > /tmp/studio.log 2>&1 &) ; sleep 8
F=$(ls -t ../data/gallery/*.png | head -1)
curl -s -F "file=@$F" 127.0.0.1:3100/api/tag | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['tags']),'tags', d['ms'],'ms','recipe:',bool(d['recipe']));print([t for t in d['tags'] if t['category']=='general'][:5])"
pkill -f "uvicorn tagger:app"; sleep 1
curl -s -F "file=@$F" 127.0.0.1:3100/api/tag -w " %{http_code}\n"
```
Expected: tags with `group` on general tags, `recipe: True` (gallery PNG is NovelAI); after killing the sidecar → `{"error":"Tagger offline — run `npm run tagger` on the Mac."} 503`. Restart the sidecar with `npm run tagger &` for Task 4.

- [ ] **Step 8: Commit**

```bash
git add studio/src/lib/tags.ts studio/src/lib/tags.test.ts studio/src/lib/tag-index.ts studio/src/lib/env.ts studio/src/app/api/tag studio/package.json
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): /api/tag proxy with YAML sort groups and recipe detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tagger screen + Studio/Tagger navigation

Basic usable layout; Night Studio polish comes in Plan 6 (design challenge 2 decides the result layout).

**Files:**
- Create: `studio/src/app/tagger/page.tsx`
- Create: `studio/src/components/NavTabs.tsx`
- Modify: `studio/src/app/layout.tsx` (render `NavTabs`)

**Interfaces:**
- Consumes: `/api/tag` (Task 3); `filterTags`, `DEFAULT_ENABLED`, `DEFAULT_EXCLUDE`, `RawTag` (Task 2); `applyTags`, `emptyState` (Plan 1/Task 2); `loadDraft`, `saveDraft` (Task 2); `DEFAULT_PARAMS` (Plan 1); `requestJson` (Plan 1 fix pass).

- [ ] **Step 1: `studio/src/components/NavTabs.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/", label: "Studio" }, { href: "/tagger", label: "Tagger" }];

export function NavTabs() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav aria-label="Sections" className="border-border mx-auto flex max-w-6xl gap-1 border-b px-4 pt-3">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}
          className={`rounded-t-md px-4 py-2 text-sm ${path === t.href ? "bg-surface text-fg font-semibold" : "text-muted"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

In `studio/src/app/layout.tsx` add `import { NavTabs } from "@/components/NavTabs";` and render `<NavTabs />` just before `{children}` inside `<body>`.

- [ ] **Step 2: `studio/src/app/tagger/page.tsx`**

```tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadDraft, saveDraft } from "@/lib/draft";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { applyTags, emptyState, type PromptState } from "@/lib/prompt";
import { DEFAULT_ENABLED, DEFAULT_EXCLUDE, filterTags, type RawTag } from "@/lib/tagger";

type TagResponse = {
  tags: RawTag[]; thresholds: Record<string, number>; ms: number;
  recipe: null | { state: PromptState; params: Partial<NaiParams> };
};
const CATEGORIES = [
  ["character", "Character"], ["copyright", "Series"], ["general", "General"],
  ["style", "Artist"], ["meta", "Meta"], ["rating", "Rating"],
] as const;

export default function Tagger() {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<TagResponse | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [exclude, setExclude] = useState(DEFAULT_EXCLUDE.join(", "));
  const [target, setTarget] = useState<"base" | number>(0);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = useMemo(
    () => (res ? filterTags(res.tags, { thresholds, enabled, exclude: exclude.split(",") }).join(", ") : ""),
    [res, thresholds, enabled, exclude],
  );

  async function analyze(file: File) {
    setPreview(URL.createObjectURL(file)); setBusy(true); setError(null); setRes(null);
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<TagResponse>("/api/tag", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRes(r.data); setThresholds(r.data.thresholds);
  }

  function send() {
    const d = loadDraft() ?? { state: emptyState(), params: DEFAULT_PARAMS };
    saveDraft({ ...d, state: applyTags({ ...emptyState(), ...d.state }, target, mode, text) });
    router.push("/");
  }

  function loadRecipe() {
    if (!res?.recipe) return;
    saveDraft({ state: res.recipe.state, params: { ...DEFAULT_PARAMS, ...res.recipe.params } });
    router.push("/");
  }

  const field = "bg-bg border-border rounded-md border px-2 py-2 text-base";
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyze(f); }}>
      <section className="space-y-3">
        <label className="border-border bg-surface grid min-h-48 cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Image to tag" className="max-h-96 w-full object-contain" /> : <span className="text-muted p-6 text-center text-sm">Tap to choose an image, or drop one here</span>}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
        </label>
        {busy && <p className="text-muted text-sm" role="status">Analyzing…</p>}
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        {res && <p className="text-muted text-xs">{res.tags.length} candidates · {res.ms} ms</p>}
        {res?.recipe && (
          <div className="bg-surface border-border flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>NovelAI recipe found in this image.</span>
            <button type="button" onClick={loadRecipe} className="text-accent font-semibold">Load recipe</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <fieldset className="bg-surface border-border space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Categories &amp; thresholds</legend>
          {CATEGORIES.map(([key, label]) => (
            <div key={key} className="flex items-center gap-3 text-sm">
              <label className="flex w-28 items-center gap-2">
                <input type="checkbox" checked={enabled[key]} onChange={(e) => setEnabled({ ...enabled, [key]: e.target.checked })} />
                {label}
              </label>
              <input type="range" min="0.05" max="1" step="0.01" aria-label={`${label} threshold`} value={thresholds[key] ?? 0.2}
                onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })} className="flex-1 accent-[var(--color-accent)]" />
              <span className="text-muted w-10 text-right tabular-nums">{(thresholds[key] ?? 0.2).toFixed(2)}</span>
            </div>
          ))}
          <label className="block text-sm">
            <span className="text-muted">Exclude</span>
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} className={`${field} mt-1 w-full`} />
          </label>
        </fieldset>

        <textarea readOnly value={text} rows={8} aria-label="Tag result" className={`${field} w-full`} />
        <p className="text-muted text-xs">{text ? text.split(", ").length : 0} tags</p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-label="Send to" value={String(target)} onChange={(e) => setTarget(e.target.value === "base" ? "base" : Number(e.target.value))} className={field}>
            <option value="base">Base prompt</option>
            {[0, 1, 2, 3].map((i) => <option key={i} value={i}>Character {i + 1}</option>)}
          </select>
          <div role="radiogroup" aria-label="Send mode" className="border-border flex overflow-hidden rounded-md border">
            {(["replace", "append"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`px-3 py-2 capitalize ${mode === m ? "bg-accent text-accent-fg" : ""}`}>{m}</button>
            ))}
          </div>
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)} disabled={!text} className="text-accent px-2 py-2 disabled:opacity-40">Copy</button>
          <button type="button" onClick={send} disabled={!text}
            className="bg-accent text-accent-fg ml-auto rounded-lg px-5 py-3 font-semibold disabled:opacity-40">Send to Studio</button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + full suite** — `cd studio && npm run typecheck && npm test 2>&1 | grep -E "ℹ (pass|fail)"` → clean, all pass.

- [ ] **Step 4: Browser check** (sidecar running; dev server localhost-only with gate off; phone width via 390 px same-origin iframe)

1. `/tagger` at 390 px: no horizontal scroll; tap target opens picker.
2. Upload the newest gallery PNG (via a same-origin `fetch` → `File` → `DataTransfer` drop, since the file chooser can't be driven) → tags appear in < 5 s, "NovelAI recipe found" shows.
3. Drag General slider to 0.9 → result shrinks live, no new network request to `/api/tag`.
4. Untick Artist → no `artist:` in result.
5. Target Character 2, Replace, Send → lands on `/` with Character 2 holding the tags; existing base untouched.
6. Stop the sidecar, upload again → red "Tagger offline…" alert, page still usable.

- [ ] **Step 5: Commit**

```bash
git add studio/src/app/tagger studio/src/components/NavTabs.tsx studio/src/app/layout.tsx
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): Tagger screen with live thresholds and send-to-Studio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

- **Design challenge 2:** how tag results land and how sending feels (sheet vs split pane vs chips), styled in the chosen Night Studio direction.
- Auto-start of the sidecar (LaunchAgent) belongs to Plan 5 (Ops); until then `npm run tagger` starts it.
