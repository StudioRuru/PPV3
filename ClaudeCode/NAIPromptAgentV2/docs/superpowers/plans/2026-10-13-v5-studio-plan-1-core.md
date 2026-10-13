# NAI V5 Studio — Plan 1: V5 Rules + Studio Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Claude skills to NovelAI V5 and ship the first usable Studio: a phone-friendly web app that edits a structured V5 prompt (base lines, character boxes, UC, rating), generates on `nai-diffusion-5-full`, keeps a history, and reuses recipes from history or from any dropped NovelAI PNG.

**Architecture:** A new Next.js 16 app in `NAIPromptAgentV2/studio/`, seeded by copying proven pieces from Project Delfino Plaza (password gate, NovelAI client, PNG chunk types). Pure logic (prompt compile, request body, recipe parsing, tag suggest) lives in small server-free modules with `node:test` checks; routes and UI are thin around them. Shared data stays in the repo root (`tags/`, `data/`); runtime artifacts go to `data/gallery/` and `data/studio.db` (git-ignored).

**Tech Stack:** Next.js 16.2.7, React 19.2.7, Tailwind v4, TypeScript 5, better-sqlite3 (raw SQL, no ORM), fflate (unzip), sharp (stealth-metadata pixels), png-chunks-extract + png-chunk-text, yaml, tsx (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` (§2, §3, §4.1, §4.2, §5, §6; phases 1–2)

**Later plans (written after this one ships, so they use what we learn):** Plan 2 Tagger (phase 3), Plan 3 Library + clusters + Grid (phases 4–5), Plan 4 Chat co-pilot (phase 6), Plan 5 Ops (phase 7), Plan 6 Design pass (phase 8), Plan 7 iOS (phase 9). **UI design challenges** run at the checkpoints listed at the end of this plan.

## Global Constraints

- Repo root is `/Users/rurudayo/ClaudeCode/NAIPromptAgentV2`; the enclosing git repo is the home directory. Commit with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit …` and end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task names.
- Model IDs: `nai-diffusion-5-full` (default), `nai-diffusion-5-curated`, `nai-diffusion-4-5-full`.
- Endpoint `https://image.novelai.net/ai/generate-image`; browser-like `User-Agent` required (Cloudflare 1010 otherwise); prompt in `input`, `parameters.prompt` and `v4_prompt.caption.base_caption`; `v4_prompt` and `v4_negative_prompt` always present; `params_version: 4`.
- Generation defaults: 832×1216, 28 steps, scale 5, `k_euler_ancestral`, `karras`, `qualityToggle: false`, `n_samples: 1`.
- NovelAI token only in server env `NOVELAI_TOKEN`; never sent to the client.
- Port 3100. Password gate active whenever `APP_PASSWORD` is set (requires `SESSION_SECRET`).
- No silent retries that could spend Anlas (transport-level retry before the request reaches NAI is fine).
- Saves are atomic (write temp + rename).
- Emitted weights use numeric `w::text::` only — never `{}`/`[]`.

## Review Focus

1. **Commas inside a weighted line** (`1.2::rain, night::`) must stay one unit through compile → recipe parse → editor; splitting it would silently change weights. → test in Task 3 and Task 5.
2. **A character box with no enabled lines** must be dropped from the request, not sent as an empty caption (NAI renders a phantom figure). → test in Task 3.
3. **Dropped PNG that is not NovelAI / was screenshotted** must return a clear "no recipe" answer, not a 500. → test in Task 5 and route check in Task 6.
4. **Gallery file names from the URL** must not allow path traversal (`..%2F`). → test in Task 6.
5. **Rating switch must not duplicate tags** already typed by the user (e.g. user already has `nsfw`). → test in Task 3.

---

### Task 1: V5 syntax reference + skill updates

**Files:**
- Create: `.claude/skills/prompt/references/v5-syntax.md`
- Modify: `.claude/skills/prompt/SKILL.md:3,6,8,146-150`
- Modify: `.claude/skills/story/SKILL.md:6,8,290`
- Modify: `.claude/skills/identify/SKILL.md:8,45`
- Modify: `.claude/skills/prompt/references/output-format.md:162,184-192`
- Modify: `.claude/skills/prompt/references/auto-weighting.md:96`
- Modify: `.claude/skills/prompt/references/tag-guide.md:61`
- Modify: `.claude/skills/prompt/references/negative-prompts.md` (No-panel doctrine section)

**Interfaces:**
- Produces: `v5-syntax.md` — the single rules doc later injected into the chat system prompt (Plan 4). Keep it under ~250 lines and self-contained.

- [ ] **Step 1: Write `v5-syntax.md`**

```markdown
# NovelAI Diffusion V5 — Prompt Syntax Reference

Default model for this tool: **V5 Full** (`nai-diffusion-5-full`). V5 Curated
(`nai-diffusion-5-curated`) is cleaner/safer but has roughly half the prompt budget. V4.5
rules live in `v45-syntax.md` and apply only when V4.5 is chosen deliberately (see
"V4.5-only features" below).

## What changed from V4.5
- New architecture, ~2× V4.5's size. Tags remain **fully supported**; natural language is now
  understood well. Mix both: tags for exact appearance, prose for composition, camera, action,
  relationships and comic layout.
- Prompt languages: English and Japanese officially. English is usually more precise.
- **Budget:** ~1,471 effective tokens over the base prompt on V5 Full (~703 on Curated), plus
  ~750 tokens of rendered text (~374 on Curated). The old 512-token pruning rule is gone — stop
  cutting useful tags for budget. Still avoid redundant tags: duplicates add noise, not strength.
- **Tag position is no longer a reliable strength lever.** Put the most important content in the
  front half for readability, but use numeric weights when something must dominate.

## Ordering (base prompt)
1. Subject count (`1girl, solo`) and any dataset prefix (`fur dataset,` / `background dataset,`).
2. Character name tag(s), then appearance, outfit, pose/expression.
3. Scene, framing/camera, lighting.
4. Style: artist tags, medium, era (`year 2025`, `meta:novel era`, `meta:golden era`).
5. Quality + complexity last: `masterpiece, very aesthetic, high complexity`.

## Weighting
- Numeric: `1.3::tag::` strengthen, `0.8::tag::` weaken, a run can wrap several tags:
  `1.2::rain, night::`. A bare `::` closes a run.
- Negative weights remove/invert in the **positive** prompt: `-1::hat::`, `-2::flat color::`.
- Tiers (unchanged): defining `1.3` (max 1–2 tags), key `1.15` (a few), de-emphasis `0.9`.
  Most tags unweighted. Over-weighting makes tags compete.
- Large weights are now used deliberately for hard switches, e.g. `2.1::transparent background::`.

## New V5 tags and prefixes
| Tag | Effect |
|---|---|
| `high complexity` | Recommended default for normal detailed images |
| `low complexity` / `medium complexity` / `ultra complexity` | Deliberately simpler / denser |
| `transparent background` | Transparent backdrop (weight it ~2 for reliability) |
| `has alpha` / `alpha transparency` | Alpha-channel output / see-through effects |
| `depthness` | Adds shading depth |
| `meta:novel era`, `meta:golden era` | Era look bias |
| `visual novel art`, `visual novel bg`, `visual novel cg`, `visual novel chibi`, `visual novel sprite` | VN styles |
| `attractive male` | Custom male-appeal tag |
| `fur dataset,` (prefix) | Furry mode |
| `background dataset,` (prefix) | No-people photographic scenes, landscapes, still life |

## Characters
- Up to 22 characters. One **character box** per character; in each box write `girl`, `boy` or
  `other` (no number) plus that character's tags. Do not also use `|` in the base.
- Positions: "AI decides" by default, or free placement on the canvas (V5 reworked this — no
  5×5 grid limit).
- Interactions: in the relevant boxes use `source#action`, `target#action`, `mutual#action`
  (e.g. `source#hug` in one box, `target#hug` in the other).
- Quality/era/artist/complexity tags belong in the **base**, never in a character box.

## Text in images
- Quote the text in the prompt (`a sign that says "OPEN"`); V5 builds the `Text:` block
  automatically. Writing your own `Text:` block disables the automation.
- If short text fails to appear, turn **Add Quality Tags** off (its `no text` suppresses it).

## Comics (new in V5)
V5 can render a full multi-panel page in one generation: describe the page and panels in
natural language and/or position character boxes. This **replaces the V4.5 no-panel
doctrine for comic requests** — only keep `comic, panel, 2koma, 4koma, multiple views` in the
negative when you want a single coherent image.

## Undesired content (negative)
Baseline unchanged (see `negative-prompts.md`). Add scene-specific removals. Prefer negative
weights in the positive prompt for one precise concept.

## V4.5-only features (not on V5 yet)
**Precise Reference** (character/style reference) and **Vibe Transfer** are not available on
V5 at launch. Any workflow that needs them — style recreation from pixels, "use Scene 1 as
Character Reference" for arcs — must say **"switch this step to V4.5 Full"**. On V5, carry
consistency with: identical character tags, a fixed seed, saved prompt chunks, and
tagger-derived artist tags.

## Cost (Opus)
V5 free generations have a usage limit (earlier models stay unlimited). Free-generation
conditions: 1 image, ≤1,048,576 px (832×1216 fits), ≤28 steps, no base image.

## Recommended defaults
832×1216, 28 steps, guidance 5, Euler Ancestral (varied) or Euler / DPM++ 2M with a fixed seed
(reproducible), Add Quality Tags off when you control quality tags yourself.
```

- [ ] **Step 2: Retarget the skills to V5**

Apply exactly these edits:

`.claude/skills/prompt/SKILL.md`
- line 3: replace `creating NAI V4.5 tags` with `creating NAI V5 tags`.
- line 6: `# NAI Prompt Generator V2 — NovelAI Diffusion V5 Full`
- line 8: replace `NovelAI Diffusion V4.5 Full` with `NovelAI Diffusion V5 Full (V4.5 only when a step needs Precise Reference or Vibe Transfer)`.
- line 146: replace `V4.5 negative emphasis` with `Negative emphasis`.
- lines 148–150: replace the section with:
  ```markdown
  ## V5 Syntax

  Read `references/v5-syntax.md` for complete syntax rules (default). Read
  `references/v45-syntax.md` only when the user picks V4.5 or a step needs Precise Reference /
  Vibe Transfer.
  ```

`.claude/skills/story/SKILL.md`
- line 6: `# Story Planner & Scene Arc Builder — NovelAI V5`
- line 8: replace `NovelAI Diffusion V4.5 Full` with `NovelAI Diffusion V5 Full`.
- line 290: replace `V4.5 syntax` with `V5 syntax (v5-syntax.md; v45-syntax.md for reference-image steps)`.
- After line 8 add: `Consistency across scenes on V5 = identical character tags + fixed seed + saved chunks. Character Reference from Scene 1 is a V4.5-only step until NovelAI ships Precise Reference on V5 — say so when you suggest it.`

`.claude/skills/identify/SKILL.md`
- line 8: replace `NovelAI Diffusion V4.5 Full` with `NovelAI Diffusion V5 Full`.
- line 45: prefix with `(V4.5 Full only — Precise Reference/Vibe Transfer are not on V5 yet.) `.

`.claude/skills/prompt/references/output-format.md`
- line 162: replace with `V5 Full allows ~1,471 effective tokens (V5 Curated ~703; V4.5 ~512 shared). Remove redundant tags; do not prune useful ones for budget on V5:`
- above line 184 add: `> Options A and B need **V4.5 Full** — Precise Reference/Vibe Transfer are not on V5 yet.`

`.claude/skills/prompt/references/auto-weighting.md`
- line 96: replace with `V5 Full allows ~1,471 effective tokens (V4.5: ~512 shared). Every tag still costs tokens — drop duplicates, keep useful detail.`

`.claude/skills/prompt/references/tag-guide.md`
- line 61: same replacement as auto-weighting line 96.

`.claude/skills/prompt/references/negative-prompts.md`
- directly under the `## No-panel doctrine (important)` heading add:
  `> **V5:** comics/multi-panel pages are now supported natively (see v5-syntax.md → Comics). The doctrine below still applies to single coherent images and to V4.5.`

- [ ] **Step 3: Verify no stale defaults remain**

Run: `cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2 && grep -n "512" .claude/skills/*/SKILL.md .claude/skills/prompt/references/{output-format,auto-weighting,tag-guide}.md; grep -n "Diffusion V4.5 Full" .claude/skills/*/SKILL.md`
Expected: every `512` hit is on a line that also says `V5`; no `Diffusion V4.5 Full` lines remain except inside "V4.5 only" clauses.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/prompt/references/v5-syntax.md .claude/skills/prompt/SKILL.md .claude/skills/story/SKILL.md .claude/skills/identify/SKILL.md .claude/skills/prompt/references/output-format.md .claude/skills/prompt/references/auto-weighting.md .claude/skills/prompt/references/tag-guide.md .claude/skills/prompt/references/negative-prompts.md
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "docs(skills): retarget prompt/story/identify to NovelAI V5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scaffold `studio/` with the password gate

**Files:**
- Delete: `closet-ui/` (untracked; contains only `node_modules/`, empty `public/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`)
- Create: `studio/package.json`, `studio/tsconfig.json`, `studio/next.config.ts`, `studio/postcss.config.mjs`, `studio/.gitignore`, `studio/.env.example`
- Create: `studio/src/app/layout.tsx`, `studio/src/app/globals.css`, `studio/src/app/page.tsx` (placeholder replaced in Task 8)
- Copy from Delfino (`/Users/rurudayo/ClaudeCode/Project Delfino Plaza`): `src/lib/auth.ts`, `src/lib/rate-limit.ts`, `src/middleware.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/login/page.tsx`, `src/types/png-chunks.d.ts`
- Create: `studio/src/lib/env.ts`, `studio/src/lib/db.ts`
- Create: `.gitignore` (repo root, `NAIPromptAgentV2/.gitignore`)

**Interfaces:**
- Produces: `env.ts` exports `REPO_DIR`, `DATA_DIR`, `GALLERY_DIR`, `TAGS_DIR`, `DB_PATH`, `NOVELAI_TOKEN`, `APP_PASSWORD`, `AUTH_ENABLED`. `db.ts` exports `db` (better-sqlite3 `Database`) with table `generations`.

- [ ] **Step 1: Remove the dead UI and create the app skeleton**

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2
ls -A closet-ui closet-ui/public   # confirm: only node_modules, public (empty), tsconfig.tsbuildinfo, next-env.d.ts
rm -rf closet-ui
mkdir -p studio/src/{app/api/auth/login,app/api/auth/logout,app/login,lib,types,components}
D="/Users/rurudayo/ClaudeCode/Project Delfino Plaza"
cp "$D/src/lib/auth.ts" "$D/src/lib/rate-limit.ts" studio/src/lib/
cp "$D/src/middleware.ts" studio/src/
cp "$D/src/app/api/auth/login/route.ts" studio/src/app/api/auth/login/
cp "$D/src/app/api/auth/logout/route.ts" studio/src/app/api/auth/logout/
cp "$D/src/app/login/page.tsx" studio/src/app/login/
cp "$D/src/types/png-chunks.d.ts" studio/src/types/
cp "$D/postcss.config.mjs" "$D/tsconfig.json" studio/
sed -i '' 's/delfino_session/studio_session/' studio/src/lib/auth.ts
sed -i '' 's/Delfino Plaza/NAI Studio/' studio/src/app/login/page.tsx
```

- [ ] **Step 2: Write `studio/package.json`**

```json
{
  "name": "nai-studio",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 0.0.0.0 -p 3100",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p 3100",
    "test": "tsx --test 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "fetch:danbooru": "curl -fsSL -o data/danbooru.csv https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv"
  },
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "fflate": "^0.8.3",
    "jose": "^6.2.3",
    "next": "16.2.7",
    "png-chunk-text": "^1.0.0",
    "png-chunks-extract": "^1.0.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "server-only": "^0.0.1",
    "sharp": "^0.34.5",
    "yaml": "^2.8.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "png-chunks-encode": "^1.0.0",
    "tailwindcss": "^4",
    "tsx": "^4.22.4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Config files**

`studio/next.config.ts`
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Phone over Tailscale/LAN must be allowed to load dev resources (Next 16 blocks otherwise).
  allowedDevOrigins: ["big-mac-mini.tail57826e.ts.net", "*.ts.net", "*.local"],
};

export default nextConfig;
```

`studio/.gitignore`
```
node_modules/
.next/
.env
data/danbooru.csv
next-env.d.ts
tsconfig.tsbuildinfo
```

`studio/.env.example`
```
NOVELAI_TOKEN=pst-...
APP_PASSWORD=
SESSION_SECRET=
# REPO_DIR defaults to the parent of studio/
```

Root `NAIPromptAgentV2/.gitignore`
```
data/gallery/
data/studio.db*
.DS_Store
```

Add to `studio/src/types/png-chunks.d.ts`:
```ts
declare module "png-chunks-encode" {
  export default function encodeChunks(chunks: { name: string; data: Uint8Array }[]): Uint8Array;
}
```

- [ ] **Step 4: `studio/src/lib/env.ts`**

```ts
import path from "node:path";

/** Repo root holding the shared tags/ and data/ folders (parent of studio/). */
export const REPO_DIR = process.env.REPO_DIR || path.resolve(process.cwd(), "..");
export const DATA_DIR = path.join(REPO_DIR, "data");
export const GALLERY_DIR = path.join(DATA_DIR, "gallery");
export const TAGS_DIR = path.join(REPO_DIR, "tags");
export const DB_PATH = path.join(DATA_DIR, "studio.db");
/** Danbooru tag CSV (name,type,count,aliases) fetched by `npm run fetch:danbooru`. */
export const DANBOORU_CSV = path.join(process.cwd(), "data", "danbooru.csv");

export const NOVELAI_TOKEN = process.env.NOVELAI_TOKEN || "";
export const APP_PASSWORD = process.env.APP_PASSWORD || "";
export const AUTH_ENABLED = APP_PASSWORD.length > 0;
```

- [ ] **Step 5: `studio/src/lib/db.ts`**

```ts
import "server-only";
import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "@/lib/env";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  model TEXT NOT NULL,
  seed INTEGER NOT NULL,
  file TEXT NOT NULL,
  state TEXT NOT NULL,
  params TEXT NOT NULL,
  grid_id TEXT
)`);
```

- [ ] **Step 6: Layout, theme, placeholder page**

`studio/src/app/globals.css`
```css
@import "tailwindcss";

/* Minimal tokens; the full visual direction comes from the design challenge (Plan 6). */
@theme {
  --color-bg: #0e1016;
  --color-surface: #171a23;
  --color-surface-2: #212534;
  --color-border: #2e3446;
  --color-fg: #eef0f6;
  --color-muted: #9aa3b8;
  --color-accent: #b49cff;
  --color-accent-fg: #160f2b;
  --color-danger: #ff5a72;
}

html, body { height: 100%; }
```

`studio/src/app/layout.tsx`
```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "NAI Studio", description: "NovelAI V5 prompt studio" };
export const viewport: Viewport = {
  themeColor: "#0e1016",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-bg text-fg min-h-full">{children}</body>
    </html>
  );
}
```

`studio/src/app/page.tsx` (temporary)
```tsx
export default function Home() {
  return <main className="p-4">NAI Studio</main>;
}
```

- [ ] **Step 7: Fix the copied middleware matcher and login route imports**

In `studio/src/middleware.ts`, replace the `PUBLIC_PATHS` set with:
```ts
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
```
and the matcher with:
```ts
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```
`login/route.ts` imports `APP_PASSWORD, AUTH_ENABLED` from `@/lib/env` — both exist in the new `env.ts`; no change needed.

- [ ] **Step 8: Install and verify**

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && npm install && npm run typecheck && npm run build
cp .env.example .env   # then the user fills NOVELAI_TOKEN (and APP_PASSWORD + SESSION_SECRET before Tailscale use)
npm run dev &  sleep 6; curl -s localhost:3100 | grep -o "NAI Studio"; kill %1
```
Expected: typecheck and build succeed; curl prints `NAI Studio` (no password set → gate off).

- [ ] **Step 9: Commit**

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2
git add .gitignore studio/package.json studio/package-lock.json studio/tsconfig.json studio/next.config.ts studio/postcss.config.mjs studio/.gitignore studio/.env.example studio/src
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): scaffold Next.js app with password gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prompt model + compiler

**Files:**
- Create: `studio/src/lib/prompt.ts`
- Test: `studio/src/lib/prompt.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Line = { id: string; text: string; weight?: number; enabled: boolean };
  type CharBox = { id: string; lines: Line[]; uc: string; center?: { x: number; y: number }; enabled: boolean };
  type Rating = "safe" | "nsfw" | "off";
  type PromptState = { base: Line[]; chars: CharBox[]; uc: string; rating: Rating };
  type CompiledChar = { prompt: string; uc: string; center?: { x: number; y: number } };
  type Compiled = { base: string; uc: string; chars: CompiledChar[] };
  function newLine(text?: string, weight?: number): Line;
  function emptyState(): PromptState;
  function lineToText(l: Line): string;          // "1.15::a, b::" or "a, b"
  function compile(s: PromptState): Compiled;
  function splitTags(s: string): string[];       // comma split that keeps w::…:: runs whole
  function parseToLines(s: string): Line[];       // inverse of compile for one prompt string
  const RATING_TAGS: Record<Rating, { add: string[]; uc: string[] }>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, emptyState, newLine, lineToText, parseToLines, splitTags } from "./prompt";

test("weighted line keeps its commas inside one run", () => {
  assert.equal(lineToText(newLine("rain, night", 1.2)), "1.2::rain, night::");
  assert.equal(lineToText(newLine("hat", -1)), "-1::hat::");
  assert.equal(lineToText(newLine("solo", 1)), "solo");
});

test("compile joins enabled lines, skips disabled and empty", () => {
  const s = emptyState();
  s.rating = "off";
  s.base = [newLine("1girl, solo"), { ...newLine("hidden"), enabled: false }, newLine("  "), newLine("smile", 1.15)];
  assert.equal(compile(s).base, "1girl, solo, 1.15::smile::");
});

test("character box with no enabled lines is dropped", () => {
  const s = emptyState();
  s.chars = [
    { id: "a", lines: [newLine("girl, red hair")], uc: "", enabled: true },
    { id: "b", lines: [{ ...newLine("boy"), enabled: false }], uc: "", enabled: true },
    { id: "c", lines: [newLine("girl")], uc: "", enabled: false },
  ];
  assert.deepEqual(compile(s).chars, [{ prompt: "girl, red hair", uc: "", center: undefined }]);
});

test("rating adds tags without duplicating user tags", () => {
  const s = emptyState();
  s.base = [newLine("1girl, nsfw")];
  s.rating = "nsfw";
  assert.equal(compile(s).base, "1girl, nsfw");
  s.rating = "safe";
  s.base = [newLine("1girl")];
  s.uc = "lowres";
  const c = compile(s);
  assert.equal(c.base, "1girl, rating:general");
  assert.equal(c.uc, "lowres, nsfw");
});

test("splitTags and parseToLines round-trip weighted runs", () => {
  assert.deepEqual(splitTags("a, 1.2::b, c::, d"), ["a", "1.2::b, c::", "d"]);
  const lines = parseToLines("1girl, 1.3::rain, night::, smile");
  assert.deepEqual(lines.map((l) => [l.text, l.weight]), [["1girl", undefined], ["rain, night", 1.3], ["smile", undefined]]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npx tsx --test src/lib/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Implement `studio/src/lib/prompt.ts`**

```ts
export type Line = { id: string; text: string; weight?: number; enabled: boolean };
export type CharBox = { id: string; lines: Line[]; uc: string; center?: { x: number; y: number }; enabled: boolean };
export type Rating = "safe" | "nsfw" | "off";
export type PromptState = { base: Line[]; chars: CharBox[]; uc: string; rating: Rating };
export type CompiledChar = { prompt: string; uc: string; center?: { x: number; y: number } };
export type Compiled = { base: string; uc: string; chars: CompiledChar[] };

/** Tags the rating switch adds to the base / UC. Tunable here, nowhere else. */
export const RATING_TAGS: Record<Rating, { add: string[]; uc: string[] }> = {
  safe: { add: ["rating:general"], uc: ["nsfw"] },
  nsfw: { add: ["nsfw"], uc: [] },
  off: { add: [], uc: [] },
};

export const DEFAULT_UC =
  "worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad hands, missing fingers, extra fingers, extra digit, fewer digits, error, jpeg artifacts, watermark, username, blurry, signature, cropped";

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export function newLine(text = "", weight?: number): Line {
  return { id: uid(), text, weight, enabled: true };
}

export function emptyState(): PromptState {
  return { base: [newLine()], chars: [], uc: DEFAULT_UC, rating: "nsfw" };
}

/** Split on commas/newlines, keeping `w::…::` runs whole. */
export function splitTags(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inWeight = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":" && s[i + 1] === ":") { inWeight = !inWeight; buf += "::"; i++; continue; }
    if ((s[i] === "," || s[i] === "\n") && !inWeight) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else buf += s[i];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const fmt = (w: number) => String(Number(w.toFixed(2)));

export function lineToText(l: Line): string {
  const t = l.text.trim().replace(/,\s*$/, "");
  if (!t) return "";
  return l.weight === undefined || l.weight === 1 ? t : `${fmt(l.weight)}::${t}::`;
}

function joinLines(lines: Line[]): string {
  return lines.filter((l) => l.enabled).map(lineToText).filter(Boolean).join(", ");
}

const key = (t: string) => t.trim().toLowerCase();

function addMissing(prompt: string, tags: string[]): string {
  const have = new Set(splitTags(prompt).map(key));
  const extra = tags.filter((t) => !have.has(key(t)));
  return [prompt, ...extra].filter(Boolean).join(", ");
}

export function compile(s: PromptState): Compiled {
  const r = RATING_TAGS[s.rating];
  const chars = s.chars
    .filter((c) => c.enabled)
    .map((c) => ({ prompt: joinLines(c.lines), uc: c.uc.trim(), center: c.center }))
    .filter((c) => c.prompt);
  return { base: addMissing(joinLines(s.base), r.add), uc: addMissing(s.uc.trim(), r.uc), chars };
}

/** One prompt string → editor lines; each weighted run becomes its own line. */
export function parseToLines(s: string): Line[] {
  const lines: Line[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) lines.push(newLine(plain.join(", "))); plain = []; };
  for (const tag of splitTags(s)) {
    const m = tag.match(/^(-?[\d.]+)::([\s\S]*?)::?$/);
    if (m) { flush(); lines.push(newLine(m[2].trim(), Number(m[1]))); }
    else plain.push(tag);
  }
  flush();
  return lines.length ? lines : [newLine()];
}
```

- [ ] **Step 4: Run tests**

Run: `cd studio && npx tsx --test src/lib/prompt.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/prompt.ts studio/src/lib/prompt.test.ts
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): prompt line model and V5 compiler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: NovelAI V5 request body + client

**Files:**
- Create: `studio/src/lib/nai-body.ts` (pure, testable — no `server-only`)
- Create: `studio/src/lib/novelai.ts` (server-only transport; adapted from Delfino `src/lib/image/novelai.ts`, vibe/img2img removed)
- Test: `studio/src/lib/nai-body.test.ts`

**Interfaces:**
- Consumes: `Compiled` from Task 3.
- Produces:
  ```ts
  type NaiParams = { model: string; width: number; height: number; steps: number; scale: number;
    sampler: string; noiseSchedule: string; cfgRescale: number; qualityToggle: boolean; seed?: number };
  const DEFAULT_PARAMS: NaiParams;
  const MODELS: { id: string; label: string }[];
  function buildNaiBody(c: Compiled, p: NaiParams): { body: object; seed: number };
  class NovelAIError extends Error { status: number }
  async function generateImage(c: Compiled, p: NaiParams, token: string): Promise<{ png: Buffer; seed: number }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNaiBody, DEFAULT_PARAMS } from "./nai-body";

const compiled = { base: "1girl, solo", uc: "lowres", chars: [] };

test("V5 body puts the prompt in all three places and keeps v4 captions", () => {
  const { body, seed } = buildNaiBody(compiled, { ...DEFAULT_PARAMS, seed: 42 }) as { body: any; seed: number };
  assert.equal(seed, 42);
  assert.equal(body.model, "nai-diffusion-5-full");
  assert.equal(body.input, "1girl, solo");
  assert.equal(body.parameters.prompt, "1girl, solo");
  assert.equal(body.parameters.v4_prompt.caption.base_caption, "1girl, solo");
  assert.equal(body.parameters.v4_negative_prompt.caption.base_caption, "lowres");
  assert.equal(body.parameters.params_version, 4);
  assert.equal(body.parameters.n_samples, 1);
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions, []);
});

test("characters fill char captions, characterPrompts and coords flag", () => {
  const c = { ...compiled, chars: [
    { prompt: "girl, red hair", uc: "hat" },
    { prompt: "boy", uc: "", center: { x: 0.7, y: 0.5 } },
  ] };
  const { body } = buildNaiBody(c, { ...DEFAULT_PARAMS, seed: 1 }) as { body: any };
  const p = body.parameters;
  assert.equal(p.v4_prompt.use_coords, true);
  assert.equal(p.v4_prompt.use_order, true);
  assert.deepEqual(p.v4_prompt.caption.char_captions[1], { char_caption: "boy", centers: [{ x: 0.7, y: 0.5 }] });
  assert.deepEqual(p.v4_negative_prompt.caption.char_captions[0], { char_caption: "hat", centers: [{ x: 0.5, y: 0.5 }] });
  assert.equal(p.characterPrompts.length, 2);
});

test("random seed when none given", () => {
  const { seed } = buildNaiBody(compiled, DEFAULT_PARAMS);
  assert.ok(Number.isInteger(seed) && seed > 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npx tsx --test src/lib/nai-body.test.ts`
Expected: FAIL — `Cannot find module './nai-body'`.

- [ ] **Step 3: Implement `studio/src/lib/nai-body.ts`**

```ts
import type { Compiled } from "./prompt";

export type NaiParams = {
  model: string; width: number; height: number; steps: number; scale: number;
  sampler: string; noiseSchedule: string; cfgRescale: number; qualityToggle: boolean; seed?: number;
};

export const MODELS = [
  { id: "nai-diffusion-5-full", label: "V5 Full" },
  { id: "nai-diffusion-5-curated", label: "V5 Curated" },
  { id: "nai-diffusion-4-5-full", label: "V4.5 Full" },
];

export const DEFAULT_PARAMS: NaiParams = {
  model: "nai-diffusion-5-full", width: 832, height: 1216, steps: 28, scale: 5,
  sampler: "k_euler_ancestral", noiseSchedule: "karras", cfgRescale: 0, qualityToggle: false,
};

const CENTER = { x: 0.5, y: 0.5 };

export function buildNaiBody(c: Compiled, p: NaiParams) {
  const seed = p.seed && p.seed > 0 ? p.seed : 1 + Math.floor(Math.random() * (2 ** 32 - 1));
  const useCoords = c.chars.some((ch) => ch.center);
  const caption = (base: string, pick: (ch: Compiled["chars"][number]) => string) => ({
    use_coords: useCoords,
    use_order: c.chars.length > 0,
    caption: {
      base_caption: base,
      char_captions: c.chars.map((ch) => ({ char_caption: pick(ch), centers: [ch.center ?? CENTER] })),
    },
  });
  const body = {
    input: c.base,
    model: p.model,
    action: "generate",
    parameters: {
      params_version: 4,
      width: p.width, height: p.height, scale: p.scale, sampler: p.sampler, steps: p.steps,
      n_samples: 1, ucPreset: 3, qualityToggle: p.qualityToggle,
      sm: false, sm_dyn: false, dynamic_thresholding: false, cfg_rescale: p.cfgRescale,
      noise_schedule: p.noiseSchedule, legacy: false, legacy_v3_extend: false,
      add_original_image: false, seed, extra_noise_seed: seed,
      negative_prompt: c.uc, prompt: c.base,
      characterPrompts: c.chars.map((ch) => ({ prompt: ch.prompt, uc: ch.uc, center: ch.center ?? CENTER, enabled: true })),
      v4_prompt: caption(c.base, (ch) => ch.prompt),
      v4_negative_prompt: caption(c.uc, (ch) => ch.uc),
    },
  };
  return { body, seed };
}
```

- [ ] **Step 4: Run tests**

Run: `cd studio && npx tsx --test src/lib/nai-body.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Implement `studio/src/lib/novelai.ts`** (transport, adapted from Delfino — keep its UA, status map and socket-retry rationale)

```ts
import "server-only";
import { unzipSync } from "fflate";
import { buildNaiBody, type NaiParams } from "./nai-body";
import type { Compiled } from "./prompt";

const ENDPOINT = "https://image.novelai.net/ai/generate-image";
// Cloudflare 403s (error 1010) without a browser-like UA. Verified in Delfino 2026-06-05.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class NovelAIError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const STATUS: Record<number, string> = {
  401: "NovelAI token invalid or expired.",
  402: "Out of Anlas / subscription required for these settings.",
  429: "NovelAI rate limit — wait a moment and try again.",
  500: "NovelAI rejected the request (often a malformed v4 prompt field).",
};

/** Retry only socket errors where the request never reached NovelAI (no double charge). */
async function post(init: RequestInit, attempts = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(ENDPOINT, init);
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code;
      const transient = code === "UND_ERR_SOCKET" || code === "ECONNRESET" || /other side closed/i.test((err as Error).message);
      if (!transient || i === attempts - 1) throw new NovelAIError(`Could not reach NovelAI: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

export async function generateImage(c: Compiled, p: NaiParams, token: string) {
  if (!token) throw new NovelAIError("NOVELAI_TOKEN is not set on the server.", 500);
  const { body, seed } = buildNaiBody(c, p);
  const res = await post({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "*/*" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new NovelAIError(STATUS[res.status] ?? `NovelAI error ${res.status}: ${detail.slice(0, 200)}`, res.status);
  }
  const files = Object.values(unzipSync(new Uint8Array(await res.arrayBuffer())));
  const png = files.find((f) => f.length);
  if (!png) throw new NovelAIError("NovelAI returned no image.");
  return { png: Buffer.from(png), seed };
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd studio && npm run typecheck` — Expected: no errors.

```bash
git add studio/src/lib/nai-body.ts studio/src/lib/nai-body.test.ts studio/src/lib/novelai.ts
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): NovelAI V5 request body and client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: NovelAI PNG recipe reader (TS port of `nai_meta.py`)

**Files:**
- Create: `studio/src/lib/recipe.ts`
- Test: `studio/src/lib/recipe.test.ts`

**Interfaces:**
- Consumes: `parseToLines`, `PromptState`, `emptyState`, `newLine` from Task 3; `NaiParams`, `DEFAULT_PARAMS` from Task 4.
- Produces:
  ```ts
  type Recipe = { model?: string; base: string; chars: string[]; uc: string; artists: string[];
    seed?: number; sampler?: string; steps?: number; scale?: number; width?: number; height?: number };
  async function readRecipe(png: Buffer): Promise<Recipe | null>;   // null = not a NovelAI image
  function recipeToState(r: Recipe): { state: PromptState; params: Partial<NaiParams> };
  ```

- [ ] **Step 1: Write the failing tests** (fixtures are built in-test with sharp + png chunk encoding)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import extract from "png-chunks-extract";
import encode from "png-chunks-encode";
import { encode as textChunk } from "png-chunk-text";
import { readRecipe, recipeToState } from "./recipe";

const comment = {
  prompt: "1girl, 1.3::rain, night::, artist:ciloranko",
  uc: "lowres",
  seed: 777, sampler: "k_euler_ancestral", steps: 28, scale: 5, width: 832, height: 1216,
  v4_prompt: { caption: { base_caption: "1girl, 1.3::rain, night::, artist:ciloranko", char_captions: [{ char_caption: "girl, red hair" }] } },
  v4_negative_prompt: { caption: { base_caption: "lowres", char_captions: [] } },
};

async function blankPng(alpha = false) {
  return sharp({ create: { width: 64, height: 64, channels: alpha ? 4 : 3, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
}

test("reads the tEXt Comment recipe", async () => {
  const chunks = extract(new Uint8Array(await blankPng()));
  chunks.splice(-1, 0, textChunk("Software", "NovelAI"), textChunk("Source", "NovelAI Diffusion V5 Full"), textChunk("Comment", JSON.stringify(comment)));
  const r = await readRecipe(Buffer.from(encode(chunks)));
  assert.ok(r);
  assert.equal(r.base, "1girl, 1.3::rain, night::, artist:ciloranko");
  assert.deepEqual(r.chars, ["girl, red hair"]);
  assert.equal(r.seed, 777);
  assert.deepEqual(r.artists, ["artist:ciloranko"]);
  const { state, params } = recipeToState(r);
  assert.equal(state.base.find((l) => l.weight === 1.3)?.text, "rain, night");
  assert.equal(state.chars.length, 1);
  assert.equal(params.seed, 777);
});

test("reads stealth alpha-LSB metadata", async () => {
  const w = 64, h = 64;
  const raw = Buffer.alloc(w * h * 4, 255);
  const payload = gzipSync(Buffer.from(JSON.stringify({ Comment: JSON.stringify(comment), Source: "NovelAI Diffusion V5 Full" })));
  const bytes = Buffer.concat([Buffer.from("stealth_pngcomp"), Buffer.alloc(4), payload]);
  bytes.writeUInt32BE(payload.length * 8, 15);
  let i = 0;
  for (const byte of bytes) for (let b = 7; b >= 0; b--, i++) {
    const x = Math.floor(i / h), y = i % h; // column-major, as NAI writes it
    raw[(y * w + x) * 4 + 3] = 254 | ((byte >> b) & 1);
  }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const r = await readRecipe(png);
  assert.equal(r?.seed, 777);
});

test("plain image returns null", async () => {
  assert.equal(await readRecipe(await blankPng(true)), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npx tsx --test src/lib/recipe.test.ts`
Expected: FAIL — `Cannot find module './recipe'`.

- [ ] **Step 3: Implement `studio/src/lib/recipe.ts`**

```ts
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import extract from "png-chunks-extract";
import { decode } from "png-chunk-text";
import { emptyState, newLine, parseToLines, type PromptState } from "./prompt";
import type { NaiParams } from "./nai-body";

export type Recipe = {
  model?: string; base: string; chars: string[]; uc: string; artists: string[];
  seed?: number; sampler?: string; steps?: number; scale?: number; width?: number; height?: number;
};

type Raw = Record<string, unknown>;

function textChunks(png: Buffer): Raw | null {
  let chunks;
  try { chunks = extract(new Uint8Array(png)); } catch { return null; }
  const text: Raw = {};
  for (const c of chunks) if (c.name === "tEXt") { const t = decode(c); text[t.keyword] = t.text; }
  const looksNai = String(text.Software ?? "").toLowerCase().startsWith("novelai") || String(text.Source ?? "").toLowerCase().includes("novelai");
  return looksNai && text.Comment ? text : null;
}

/** NAI stealth metadata: alpha-channel LSBs, column-major, "stealth_png{comp,info}" magic. */
async function stealth(png: Buffer): Promise<Raw | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let i = 0;
  const bit = () => { const x = Math.floor(i / h), y = i % h; i++; return data[(y * w + x) * 4 + 3] & 1; };
  const bytes = (n: number) => {
    if (i + n * 8 > w * h) throw new Error("eof");
    const out = Buffer.alloc(n);
    for (let k = 0; k < n; k++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bit(); out[k] = v; }
    return out;
  };
  try {
    const magic = bytes(15).toString("utf8");
    if (magic !== "stealth_pngcomp" && magic !== "stealth_pnginfo") return null;
    const len = bytes(4).readUInt32BE(0) / 8;
    const payload = bytes(len);
    return JSON.parse((magic === "stealth_pngcomp" ? gunzipSync(payload) : payload).toString("utf8"));
  } catch {
    return null;
  }
}

export async function readRecipe(png: Buffer): Promise<Recipe | null> {
  const raw = textChunks(png) ?? (await stealth(png));
  if (!raw) return null;
  let c: Raw;
  try { c = typeof raw.Comment === "string" ? JSON.parse(raw.Comment) : (raw.Comment as Raw) ?? {}; } catch { return null; }
  const v4 = (c.v4_prompt as { caption?: { base_caption?: string; char_captions?: { char_caption?: string }[] } })?.caption;
  const v4n = (c.v4_negative_prompt as { caption?: { base_caption?: string } })?.caption;
  const base = (v4?.base_caption ?? (c.prompt as string) ?? "").trim();
  const chars = (v4?.char_captions ?? []).map((x) => (x.char_caption ?? "").trim()).filter(Boolean);
  const artists = [...new Set(`${c.prompt ?? ""}, ${base}`.match(/artist:[^,|:]+/gi)?.map((a) => a.trim()) ?? [])];
  return {
    model: (raw.Source ?? raw.Software) as string | undefined,
    base, chars, uc: (v4n?.base_caption ?? (c.uc as string) ?? "").trim(), artists,
    seed: c.seed as number | undefined, sampler: c.sampler as string | undefined, steps: c.steps as number | undefined,
    scale: c.scale as number | undefined, width: c.width as number | undefined, height: c.height as number | undefined,
  };
}

export function recipeToState(r: Recipe): { state: PromptState; params: Partial<NaiParams> } {
  const state: PromptState = {
    ...emptyState(),
    rating: "off",
    base: parseToLines(r.base),
    uc: r.uc,
    chars: r.chars.map((p) => ({ id: newLine().id, lines: parseToLines(p), uc: "", enabled: true })),
  };
  const params: Partial<NaiParams> = {};
  if (r.seed) params.seed = r.seed;
  if (r.sampler) params.sampler = r.sampler;
  if (r.steps) params.steps = r.steps;
  if (r.scale) params.scale = r.scale;
  if (r.width && r.height) { params.width = r.width; params.height = r.height; }
  return { state, params };
}
```

- [ ] **Step 4: Run tests**

Run: `cd studio && npx tsx --test src/lib/recipe.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/recipe.ts studio/src/lib/recipe.test.ts studio/src/types/png-chunks.d.ts
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): read NovelAI recipes from PNG text chunks and stealth alpha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Generate, history, gallery and recipe API routes

**Files:**
- Create: `studio/src/lib/gallery.ts`
- Test: `studio/src/lib/gallery.test.ts`
- Create: `studio/src/app/api/generate/route.ts`
- Create: `studio/src/app/api/generations/route.ts`
- Create: `studio/src/app/api/gallery/[name]/route.ts`
- Create: `studio/src/app/api/recipe/route.ts`

**Interfaces:**
- Consumes: `compile`, `PromptState` (Task 3); `generateImage`, `NovelAIError` (Task 4), `NaiParams`, `DEFAULT_PARAMS` (Task 4); `readRecipe`, `recipeToState` (Task 5); `db` (Task 2); `GALLERY_DIR`, `NOVELAI_TOKEN` (Task 2).
- Produces (HTTP):
  - `POST /api/generate` body `{ state: PromptState, params: NaiParams }` → `200 { id, file, seed }` | `4xx/5xx { error }`
  - `GET /api/generations?limit=50` → `{ items: { id, created_at, model, seed, file, state, params }[] }` (state/params parsed)
  - `GET /api/gallery/:name` → `image/png`
  - `POST /api/recipe` multipart `file` → `200 { recipe, state, params }` | `422 { error: "No NovelAI recipe in this image…" }`
- Produces (lib): `safeGalleryName(name: string): string | null`, `saveImage(png: Buffer, seed: number): Promise<string>` (returns file name).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeGalleryName } from "./gallery";

test("gallery names reject traversal and non-png", () => {
  assert.equal(safeGalleryName("20261013-120000-42.png"), "20261013-120000-42.png");
  assert.equal(safeGalleryName("../studio.db"), null);
  assert.equal(safeGalleryName("..%2Fstudio.db"), null);
  assert.equal(safeGalleryName("a/b.png"), null);
  assert.equal(safeGalleryName("x.txt"), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npx tsx --test src/lib/gallery.test.ts`
Expected: FAIL — `Cannot find module './gallery'`.

- [ ] **Step 3: Implement `studio/src/lib/gallery.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { GALLERY_DIR } from "./env";

export function safeGalleryName(name: string): string | null {
  return /^[\w-]+\.png$/.test(name) ? name : null;
}

/** Atomic write (temp + rename) so a crash never leaves a half PNG. */
export async function saveImage(png: Buffer, seed: number): Promise<string> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const name = `${stamp}-${seed}.png`;
  const tmp = path.join(GALLERY_DIR, `.${name}.tmp`);
  await fs.writeFile(tmp, png);
  await fs.rename(tmp, path.join(GALLERY_DIR, name));
  return name;
}
```

- [ ] **Step 4: Run test** — `cd studio && npx tsx --test src/lib/gallery.test.ts` → PASS.

- [ ] **Step 5: Routes**

`studio/src/app/api/generate/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOVELAI_TOKEN } from "@/lib/env";
import { saveImage } from "@/lib/gallery";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { generateImage, NovelAIError } from "@/lib/novelai";
import { compile, type PromptState } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { state, params } = (await req.json().catch(() => ({}))) as { state?: PromptState; params?: Partial<NaiParams> };
  if (!state?.base) return NextResponse.json({ error: "Missing prompt state." }, { status: 400 });
  const compiled = compile(state);
  if (!compiled.base) return NextResponse.json({ error: "Base prompt is empty." }, { status: 400 });
  const p = { ...DEFAULT_PARAMS, ...params };
  try {
    const { png, seed } = await generateImage(compiled, p, NOVELAI_TOKEN);
    const file = await saveImage(png, seed);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO generations (created_at, model, seed, file, state, params) VALUES (?, ?, ?, ?, ?, ?)")
      .run(Date.now(), p.model, seed, file, JSON.stringify(state), JSON.stringify({ ...p, seed }));
    return NextResponse.json({ id: Number(lastInsertRowid), file, seed });
  } catch (err) {
    const status = err instanceof NovelAIError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status: status >= 400 ? status : 502 });
  }
}
```

`studio/src/app/api/generations/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; created_at: number; model: string; seed: number; file: string; state: string; params: string };

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const rows = db.prepare("SELECT * FROM generations ORDER BY id DESC LIMIT ?").all(limit) as Row[];
  return NextResponse.json({ items: rows.map((r) => ({ ...r, state: JSON.parse(r.state), params: JSON.parse(r.params) })) });
}
```

`studio/src/app/api/gallery/[name]/route.ts`
```ts
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { GALLERY_DIR } from "@/lib/env";
import { safeGalleryName } from "@/lib/gallery";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = safeGalleryName((await params).name);
  if (!name) return NextResponse.json({ error: "Bad name" }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(GALLERY_DIR, name));
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
```

`studio/src/app/api/recipe/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { readRecipe, recipeToState } from "@/lib/recipe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  const recipe = await readRecipe(Buffer.from(await file.arrayBuffer())).catch(() => null);
  if (!recipe)
    return NextResponse.json(
      { error: "No NovelAI recipe in this image — it was probably screenshotted or re-saved, which strips it." },
      { status: 422 },
    );
  return NextResponse.json({ recipe, ...recipeToState(recipe) });
}
```

- [ ] **Step 6: Live end-to-end check** (needs `NOVELAI_TOKEN` in `studio/.env`; one 0-Anlas Opus generation)

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && npm run dev &  sleep 6
curl -s -X POST localhost:3100/api/generate -H 'Content-Type: application/json' \
  -d '{"state":{"base":[{"id":"a","text":"1girl, solo, smile, high complexity","enabled":true}],"chars":[],"uc":"lowres","rating":"safe"}}'
# Expected: {"id":1,"file":"2026…-<seed>.png","seed":<seed>}
F=$(ls -t ../data/gallery/*.png | head -1); curl -s -F "file=@$F" localhost:3100/api/recipe | head -c 300
# Expected: JSON whose recipe.base contains "1girl, solo, smile, high complexity, rating:general" and recipe.model mentions V5
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3100/api/gallery/..%2Fstudio.db"   # Expected: 400
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/gallery.ts studio/src/lib/gallery.test.ts studio/src/app/api/generate studio/src/app/api/generations studio/src/app/api/gallery studio/src/app/api/recipe
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): generate, history, gallery and recipe routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tag index + autocomplete API

**Files:**
- Create: `studio/src/lib/tags.ts` (pure: parse + suggest)
- Test: `studio/src/lib/tags.test.ts`
- Create: `studio/src/lib/tag-index.ts` (server-only loader, cached)
- Create: `studio/src/app/api/tags/route.ts`

**Interfaces:**
- Produces:
  ```ts
  type TagEntry = { name: string; category: string; count: number; aliases: string[]; source: "danbooru" | "yaml" | "v5" };
  const V5_TAGS: string[];
  function parseDanbooruCsv(csv: string): TagEntry[];
  function yamlTagNames(doc: unknown): string[];    // every `tag:` value anywhere in a parsed YAML doc
  function buildIndex(entries: TagEntry[]): TagEntry[];   // dedupe by name, keep highest count, merge sources
  function suggest(index: TagEntry[], q: string, limit?: number): TagEntry[];
  function dots(count: number): 0 | 1 | 2 | 3;
  ```
  HTTP: `GET /api/tags?q=red%20ha` → `{ items: TagEntry[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, dots, parseDanbooruCsv, suggest, yamlTagNames } from "./tags";

const csv = `1girl,0,6008644,"1girls,sole_female"
red_hair,0,900000,"redhead"
red_eyes,0,1000000,""
hatsune_miku,4,150000,"miku"
artist_x,1,500,""`;

test("csv parse normalizes underscores and categories", () => {
  const e = parseDanbooruCsv(csv);
  assert.deepEqual(e[1], { name: "red hair", category: "general", count: 900000, aliases: ["redhead"], source: "danbooru" });
  assert.equal(e[3].category, "character");
  assert.equal(e[4].category, "artist");
});

test("yaml walk finds nested tag values", () => {
  const doc = { subcategories: { tops: { tags: [{ tag: "white shirt" }, { tag: "frilled shirt", aliases: ["x"] }] } } };
  assert.deepEqual(yamlTagNames(doc), ["white shirt", "frilled shirt"]);
});

test("suggest: prefix before contains, then count; aliases match", () => {
  const idx = buildIndex([...parseDanbooruCsv(csv), { name: "frilled shirt", category: "general", count: 0, aliases: [], source: "yaml" }]);
  assert.deepEqual(suggest(idx, "red").map((t) => t.name), ["red eyes", "red hair"]);
  assert.equal(suggest(idx, "redhead")[0].name, "red hair");
  assert.equal(suggest(idx, "shirt")[0].name, "frilled shirt");
  assert.deepEqual(suggest(idx, "  "), []);
});

test("knowledge dots", () => {
  assert.deepEqual([0, 999, 1000, 10000, 100000].map(dots), [0, 0, 1, 2, 3]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio && npx tsx --test src/lib/tags.test.ts` → FAIL (`Cannot find module './tags'`).

- [ ] **Step 3: Implement `studio/src/lib/tags.ts`**

```ts
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
```

- [ ] **Step 4: Run tests** — `cd studio && npx tsx --test src/lib/tags.test.ts` → 4 pass.

- [ ] **Step 5: Loader and route**

`studio/src/lib/tag-index.ts`
```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DANBOORU_CSV, TAGS_DIR } from "./env";
import { buildIndex, parseDanbooruCsv, V5_TAGS, yamlTagNames, type TagEntry } from "./tags";

let cache: TagEntry[] | null = null;

export function tagIndex(): TagEntry[] {
  if (cache) return cache;
  const entries: TagEntry[] = fs.existsSync(DANBOORU_CSV) ? parseDanbooruCsv(fs.readFileSync(DANBOORU_CSV, "utf8")) : [];
  for (const f of fs.readdirSync(TAGS_DIR).filter((f) => f.endsWith(".yaml"))) {
    for (const name of yamlTagNames(parse(fs.readFileSync(path.join(TAGS_DIR, f), "utf8"))))
      entries.push({ name, category: "general", count: 0, aliases: [], source: "yaml" });
  }
  for (const name of V5_TAGS) entries.push({ name, category: "v5", count: 0, aliases: [], source: "v5" });
  return (cache = buildIndex(entries));
}
```

`studio/src/app/api/tags/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { tagIndex } from "@/lib/tag-index";
import { suggest } from "@/lib/tags";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return NextResponse.json({ items: suggest(tagIndex(), req.nextUrl.searchParams.get("q") ?? "") });
}
```

- [ ] **Step 6: Fetch CSV and check live**

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && mkdir -p data && npm run fetch:danbooru && wc -l data/danbooru.csv
npm run dev &  sleep 6; curl -s "localhost:3100/api/tags?q=red%20ha" | head -c 300; echo; curl -s "localhost:3100/api/tags?q=high%20comp" | head -c 200; kill %1
```
Expected: ~140k lines; first query starts with `red hair`; second returns `high complexity` with `source":"v5"`.

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/tags.ts studio/src/lib/tags.test.ts studio/src/lib/tag-index.ts studio/src/app/api/tags
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): tag index (Danbooru + YAML + V5) and autocomplete API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Studio UI — editor, generate, history, recipe reuse

Basic usable, mobile-first layout only; visual polish is deferred to the design challenge (Plan 6).

**Files:**
- Create: `studio/src/components/TagInput.tsx`
- Create: `studio/src/components/LineList.tsx`
- Create: `studio/src/components/CharacterBoxes.tsx`
- Create: `studio/src/components/ParamsBar.tsx`
- Create: `studio/src/components/HistoryStrip.tsx`
- Replace: `studio/src/app/page.tsx`

**Interfaces:**
- Consumes: `PromptState`, `Line`, `CharBox`, `newLine`, `emptyState` (Task 3); `NaiParams`, `DEFAULT_PARAMS`, `MODELS` (Task 4); `dots`, `TagEntry` (Task 7 — import from `@/lib/tags`, which is server-free); HTTP routes from Tasks 6–7.
- Produces: none consumed later except the component names (Plan 2 adds "send to base / Character N" by calling the page's `setState`).

- [ ] **Step 1: `TagInput.tsx`** — textarea that autocompletes the fragment after the last comma

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { dots, type TagEntry } from "@/lib/tags";

export function TagInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [items, setItems] = useState<TagEntry[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fragment = value.split(",").pop()?.trim() ?? "";

  useEffect(() => {
    clearTimeout(timer.current);
    if (fragment.length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/tags?q=${encodeURIComponent(fragment)}`).then((r) => r.json()).catch(() => ({ items: [] }));
      setItems(r.items.slice(0, 8));
    }, 150);
  }, [fragment]);

  const pick = (name: string) => {
    const head = value.includes(",") ? value.slice(0, value.lastIndexOf(",") + 1) + " " : "";
    onChange(`${head}${name}, `);
    setItems([]);
  };

  return (
    <div className="relative flex-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={1}
        className="bg-bg border-border focus:border-accent w-full resize-y rounded-md border px-2 py-2 text-base outline-none"
      />
      {items.length > 0 && (
        <ul role="listbox" className="bg-surface-2 border-border absolute z-20 mt-1 w-full overflow-hidden rounded-md border text-sm shadow-lg">
          {items.map((t) => (
            <li key={t.name}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t.name)}
                className="hover:bg-surface flex w-full items-center justify-between px-3 py-2 text-left">
                <span>{t.name}</span>
                <span className="text-muted text-xs">{t.source === "danbooru" ? "●".repeat(dots(t.count)) || "·" : t.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `LineList.tsx`** — numbered lines with weight, enable toggle, delete, add

```tsx
"use client";
import { newLine, type Line } from "@/lib/prompt";
import { TagInput } from "./TagInput";

export function LineList({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={l.id} className={`flex items-start gap-2 ${l.enabled ? "" : "opacity-40"}`}>
          <button type="button" aria-label={l.enabled ? "Disable line" : "Enable line"} onClick={() => set(i, { enabled: !l.enabled })}
            className="text-muted w-6 pt-2 text-right text-xs">{i + 1}</button>
          <TagInput value={l.text} onChange={(text) => set(i, { text })} placeholder="tags or natural language" />
          <input type="number" step="0.05" inputMode="decimal" aria-label="Weight" placeholder="1"
            value={l.weight ?? ""} onChange={(e) => set(i, { weight: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="bg-bg border-border w-16 rounded-md border px-2 py-2 text-base" />
          <button type="button" aria-label="Delete line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [newLine()])}
            className="text-muted px-2 py-2">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="text-accent text-sm">+ line</button>
    </div>
  );
}
```

- [ ] **Step 3: `CharacterBoxes.tsx`**

```tsx
"use client";
import { newLine, type CharBox } from "@/lib/prompt";
import { LineList } from "./LineList";

export function CharacterBoxes({ chars, onChange }: { chars: CharBox[]; onChange: (c: CharBox[]) => void }) {
  const set = (i: number, patch: Partial<CharBox>) => onChange(chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {chars.map((c, i) => (
        <section key={c.id} className="bg-surface border-border rounded-lg border p-3">
          <header className="mb-2 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={c.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
              Character {i + 1}
            </label>
            <button type="button" className="text-muted" onClick={() => onChange(chars.filter((_, j) => j !== i))}>Remove</button>
          </header>
          <LineList lines={c.lines} onChange={(lines) => set(i, { lines })} />
          <input value={c.uc} onChange={(e) => set(i, { uc: e.target.value })} placeholder="character undesired content"
            className="bg-bg border-border mt-2 w-full rounded-md border px-2 py-2 text-base" />
          {/* ponytail: numeric x/y (0–1); a drag-on-canvas picker comes with the design pass. */}
          <div className="text-muted mt-2 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!c.center} onChange={(e) => set(i, { center: e.target.checked ? { x: 0.5, y: 0.5 } : undefined })} />
              Custom position
            </label>
            {c.center && (["x", "y"] as const).map((k) => (
              <input key={k} aria-label={`Position ${k}`} type="number" min="0" max="1" step="0.1" value={c.center![k]}
                onChange={(e) => set(i, { center: { ...c.center!, [k]: Math.min(1, Math.max(0, Number(e.target.value))) } })}
                className="bg-bg border-border w-16 rounded-md border px-2 py-1 text-base" />
            ))}
          </div>
        </section>
      ))}
      {chars.length < 22 && (
        <button type="button" className="text-accent text-sm"
          onClick={() => onChange([...chars, { id: newLine().id, lines: [newLine("girl")], uc: "", enabled: true }])}>
          + character
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `ParamsBar.tsx`**

```tsx
"use client";
import { MODELS, type NaiParams } from "@/lib/nai-body";
import type { Rating } from "@/lib/prompt";

export function ParamsBar({ params, onParams, rating, onRating }: {
  params: NaiParams; onParams: (p: NaiParams) => void; rating: Rating; onRating: (r: Rating) => void;
}) {
  const num = (k: keyof NaiParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onParams({ ...params, [k]: e.target.value === "" ? undefined : Number(e.target.value) });
  const field = "bg-bg border-border rounded-md border px-2 py-2 text-base";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={params.model} onChange={(e) => onParams({ ...params, model: e.target.value })} className={field}>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div role="radiogroup" aria-label="Rating" className="border-border flex overflow-hidden rounded-md border">
        {(["safe", "nsfw", "off"] as Rating[]).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={rating === r} onClick={() => onRating(r)}
            className={`px-3 py-2 uppercase ${rating === r ? "bg-accent text-accent-fg" : ""}`}>{r}</button>
        ))}
      </div>
      <input aria-label="Width" type="number" step="64" value={params.width} onChange={num("width")} className={`${field} w-20`} />
      <span>×</span>
      <input aria-label="Height" type="number" step="64" value={params.height} onChange={num("height")} className={`${field} w-20`} />
      <input aria-label="Steps" type="number" value={params.steps} onChange={num("steps")} className={`${field} w-16`} />
      <input aria-label="Guidance" type="number" step="0.1" value={params.scale} onChange={num("scale")} className={`${field} w-16`} />
      <input aria-label="Seed (blank = random)" type="number" placeholder="random seed" value={params.seed ?? ""} onChange={num("seed")} className={`${field} w-36`} />
      {params.width * params.height > 1_048_576 || params.steps > 28 ? <span className="text-danger">costs Anlas</span> : null}
    </div>
  );
}
```

- [ ] **Step 5: `HistoryStrip.tsx`**

```tsx
"use client";
import type { NaiParams } from "@/lib/nai-body";
import type { PromptState } from "@/lib/prompt";

export type Generation = { id: number; file: string; seed: number; model: string; state: PromptState; params: NaiParams };

export function HistoryStrip({ items, onOpen }: { items: Generation[]; onOpen: (g: Generation) => void }) {
  if (!items.length) return <p className="text-muted text-sm">No generations yet.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {items.map((g) => (
        <button key={g.id} type="button" onClick={() => onOpen(g)} className="shrink-0" aria-label={`Open generation ${g.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/gallery/${g.file}`} alt="" loading="lazy" className="border-border h-24 w-auto rounded-md border" />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: `page.tsx`** — state, draft persistence, generate, viewer, reuse, PNG drop

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { CharacterBoxes } from "@/components/CharacterBoxes";
import { HistoryStrip, type Generation } from "@/components/HistoryStrip";
import { LineList } from "@/components/LineList";
import { ParamsBar } from "@/components/ParamsBar";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { emptyState, type PromptState } from "@/lib/prompt";

const DRAFT = "studio-draft-v1";

export default function Studio() {
  const [state, setState] = useState<PromptState>(emptyState);
  const [params, setParams] = useState<NaiParams>(DEFAULT_PARAMS);
  const [history, setHistory] = useState<Generation[]>([]);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await fetch("/api/generations?limit=60").then((r) => r.json()).catch(() => ({ items: [] }));
    setHistory(r.items);
    return r.items as Generation[];
  }, []);

  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null"); if (d) { setState(d.state); setParams(d.params); } } catch {}
    loadHistory().then((items) => setCurrent(items[0] ?? null));
  }, [loadHistory]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify({ state, params })); } catch {}
  }, [state, params]);

  async function generate() {
    setBusy(true); setError(null);
    const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, params }) });
    const data = await res.json().catch(() => ({ error: "Bad response from server." }));
    setBusy(false);
    if (!res.ok) { setError(data.error); return; }
    const items = await loadHistory();
    setCurrent(items.find((g) => g.id === data.id) ?? null);
  }

  function reuse(g: Pick<Generation, "state" | "params">) {
    setState(g.state);
    setParams({ ...DEFAULT_PARAMS, ...g.params });
  }

  async function onDrop(file: File) {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/recipe", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    reuse({ state: data.state, params: { ...params, ...data.params } });
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 pb-28 lg:grid-cols-[1fr_1fr]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onDrop(f); }}>
      <section className="space-y-4">
        <ParamsBar params={params} onParams={setParams} rating={state.rating} onRating={(rating) => setState({ ...state, rating })} />
        <div className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Base prompt</h2>
          <LineList lines={state.base} onChange={(base) => setState({ ...state, base })} />
        </div>
        <CharacterBoxes chars={state.chars} onChange={(chars) => setState({ ...state, chars })} />
        <div className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Undesired content</h2>
          <textarea value={state.uc} onChange={(e) => setState({ ...state, uc: e.target.value })} rows={3}
            className="bg-bg border-border w-full rounded-md border px-2 py-2 text-base" />
        </div>
        <label className="text-muted block text-sm">
          Load recipe from a NovelAI PNG
          <input type="file" accept="image/png" className="mt-1 block" onChange={(e) => e.target.files?.[0] && onDrop(e.target.files[0])} />
        </label>
      </section>

      <section className="space-y-3">
        {current ? (
          <figure className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/gallery/${current.file}`} alt="Latest generation" className="border-border w-full rounded-lg border" />
            <figcaption className="text-muted flex items-center justify-between text-sm">
              <span>seed {current.seed}</span>
              <button type="button" className="text-accent" onClick={() => reuse(current)}>Reuse recipe</button>
            </figcaption>
          </figure>
        ) : <div className="border-border text-muted grid aspect-[832/1216] place-items-center rounded-lg border">Nothing yet</div>}
        <HistoryStrip items={history} onOpen={setCurrent} />
      </section>

      <div className="bg-bg/90 border-border fixed inset-x-0 bottom-0 border-t p-3 backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {error && <p role="alert" className="text-danger flex-1 text-sm">{error}</p>}
          <button type="button" onClick={generate} disabled={busy}
            className="bg-accent text-accent-fg ml-auto rounded-lg px-6 py-3 text-base font-semibold disabled:opacity-50">
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify in a real browser (desktop + phone width)**

```bash
cd /Users/rurudayo/ClaudeCode/NAIPromptAgentV2/studio && npm run typecheck && npm test && npm run dev
```
Then, using the `run` skill / Chrome tools at 390×844 and at desktop width, check:
1. Type `red ha` in a base line → `red hair` suggestion with dots; tap inserts `red hair, `.
2. Add Character 1, set rating SAFE, Generate → image appears, history strip gains a thumbnail, no horizontal page scroll at 390 px.
3. Change a line's weight to `1.3`, reload the page → draft survives.
4. Tap an older thumbnail → "Reuse recipe" restores its lines, characters and seed.
5. Upload the newest file from `data/gallery/` via "Load recipe" → editor fills; upload a screenshot → red "No NovelAI recipe…" message.
6. Stop the network (or unset `NOVELAI_TOKEN` and restart) → Generate shows the readable error, page stays usable.

- [ ] **Step 8: Commit**

```bash
git add studio/src/components studio/src/app/page.tsx
git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit -m "feat(studio): mobile-first Studio editor with generate, history and recipe reuse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## UI design challenges (checkpoints, not tasks)

Run each as a short challenge with 2–3 competing directions shown as live mockups in the browser
(impeccable / frontend-design skills). The user picks one, and the pick is recorded as the brief
for Plan 6, so polish never blocks building.

1. **After Plan 1 (now):** overall direction for the Studio. For example: "night studio" (dense
   and pro, close to the reference app), "editorial" (calm, large type), or "neon console". Judge
   on a 390 px phone first.
2. **After Plan 2 (Tagger):** where tag results land and how sending tags feels (sheet, split
   pane, or drag chips).
3. **After Plan 4 (Chat):** how the patch card looks and how the chat drawer sits next to the
   editor on phone vs desktop.
4. **Plan 6:** apply the winning directions across all screens with full loading, empty and error
   states. Then **Plan 7** builds the iOS shell to match.
