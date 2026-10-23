# Mac Studio (desktop Photo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A wide-screen 4-column Photo pane (settings · vertical takes strip · big image · Miyabi), plus LoRA fit/trigger info and Miyabi "suggest, you click" fixes, with the LoRA improvements also on the phone.

**Architecture:** LoRA info (family, trigger words, weight) is resolved server-side from safetensors headers (Mac files) and a civitai.red by-hash lookup (manifest sha256 or a one-time hash), cached in a `comfy_lora_info` table. Prompt trigger insert/remove is a pure module; Miyabi's fixes come from a deterministic rule table (safe, testable patches), and the quick-tier model only writes her wording. `PhotoPane` keeps all state; a `useWide()` media query picks the phone render (unchanged) or the desktop render.

**Tech Stack:** Next.js 16 App Router, React, Tailwind, better-sqlite3, Ollama (quick tier), `tsx --test` (node:test + assert/strict).

**Spec:** `docs/superpowers/specs/2026-10-23-mac-studio-design.md`

## Global Constraints

- Phone layout unchanged below the breakpoint (only the LoRA list and its trigger behaviour change there, by decision 9).
- Nothing applies settings or spends GPU without the owner's tap: Apply only edits the recipe; Render stays the owner's button.
- Miyabi's patch never changes `model`. Allowed fields: prompt, LoRA strengths, steps, cfg, sampler, scheduler, width, height, seed, hires, faceFix.
- Unknown LoRA family = fits every model (never hidden). "Show all" switch always present.
- Trigger words never duplicate; removal deletes only words the studio inserted, never owner-typed words.
- Model lookups via civitai.red only (`https://civitai.red/api/v1/model-versions/by-hash/<sha256>`, Bearer `CIVITAI_TOKEN` from `src/lib/env.ts`). Never log or print the token.
- No pod time, no Anlas. Tests use fakes; never hit civitai.red or the pod in tests.
- Repo rules: never `next build` in the live studio dir; never write real `data/`; temp dev servers use `REPO_DIR=$S/repo` and blank `NOVELAI_TOKEN= APP_PASSWORD= HYPERSTACK_API_KEY= COMFY_TS_AUTHKEY= HF_TOKEN= CIVITAIRED_KEY=`; no branch switching; commit named files only with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push/stash/`add -A`.
- Verify each task: `cd studio && npm test && npx tsc --noEmit` (827 tests pass at start).

**Already satisfied (no task):** decision 10, separate prompts. `VideoPane` already keeps its own `r.prompt` (`VideoPane.tsx:125`). ComfyScreen's `prompt` state only feeds PhotoPane, so trigger words, restores and fixes can't reach Video.

## Review Focus

1. **Pod off or civitai.red unreachable/404:** LoRA list still renders. Info comes back `family: null`, so every LoRA shows, and the route never throws. (Task 1 test `lookup failure caches nothing and reports unknown`.)
2. **Owner already typed a trigger word before adding the LoRA:** the word is not duplicated, and removing the LoRA leaves it. (Task 2 test `pre-typed word is neither duplicated nor removed`.)
3. **Apply a stale suggestion after the stack changed** (LoRA removed or model switched): unknown LoRA names in the patch are ignored, and `model` is never touched. (Task 5 test `safePatch drops unknown loras and model`.)
4. **Ollama down when a chip is tapped:** the suggestion still arrives with a canned line and a working Apply. (Task 5 test `offline model falls back to canned line`.)
5. **Window resized across the breakpoint mid-session:** recipe, prompt, takes and the open suggestion survive. State lives in PhotoPane, and layouts are pure renders. (Task 4, manual check step.)

---

### Task 1: LoRA info (family, trigger words, weight) + route

**Files:**
- Create: `studio/src/lib/comfy/lora-info.ts`, `studio/src/lib/comfy/lora-info.test.ts`, `studio/src/app/api/comfy/lora-info/route.ts`
- Modify: `studio/src/lib/comfy/store.ts:20-25` (add table to `migrate`)

**Interfaces:**
- Consumes: `LORA_DIR`, `isSafetensors` (`loras.ts`); `family()` type (`recipe.ts`); `CIVITAI_TOKEN` (`env.ts`); `comfyDb()`.
- Produces:
  - `type Family = ReturnType<typeof family>` (exported from `recipe.ts` if it isn't already).
  - `type LoraInfo = { family: Family | null; words: string[]; weight: number | null }`.
  - `familyOf(base: string): Family | null`.
  - `fromHeader(meta: Record<string, string>): LoraInfo`.
  - `fromCivitai(json: unknown): LoraInfo`.
  - `fits(info: LoraInfo | undefined, f: Family): boolean`, which is true when info is missing or `family` is null.
  - `resolveInfo(names: string[], deps: { db: Db; manifestSha: Map<string,string>; dir?: string; fetch?: typeof fetch }): Promise<Record<string, LoraInfo>>`.
  - Route: `GET /api/comfy/lora-info?names=a.safetensors,b.safetensors` returns `{ info: Record<string, LoraInfo> }`.
- New table: `CREATE TABLE IF NOT EXISTS comfy_lora_info (name TEXT PRIMARY KEY, info TEXT NOT NULL)`.

- [ ] **Step 1: Write failing tests** in `lora-info.test.ts`:

```ts
test("familyOf maps base-model strings", () => {
  for (const s of ["SDXL 1.0", "Pony", "Illustrious", "NoobAI", "sdxl_base_v1-0", "stable-diffusion-xl-v1-base/lora"]) assert.equal(familyOf(s), "sdxl");
  assert.equal(familyOf("Qwen"), "qwen"); assert.equal(familyOf("qwen-image/lora"), "qwen");
  assert.equal(familyOf("Krea 2"), "krea2"); assert.equal(familyOf("MOSS"), "moss");
  assert.equal(familyOf("Wan Video 2.2 I2V-A14B"), null); assert.equal(familyOf(""), null);
});
test("fromHeader reads base model and top tags", () => {
  const i = fromHeader({ ss_base_model_version: "sdxl_base_v1-0", ss_tag_frequency: JSON.stringify({ "10_lenovo": { "lenovo woman": 40, "smile": 3 } }) });
  assert.deepEqual(i, { family: "sdxl", words: ["lenovo woman"], weight: null });
});
test("fromCivitai reads baseModel and trainedWords", () => {
  assert.deepEqual(fromCivitai({ baseModel: "Qwen", trainedWords: ["lenovo woman, ", " detailed skin"] }), { family: "qwen", words: ["lenovo woman", "detailed skin"], weight: null });
});
test("fits treats unknown as fitting everything", () => {
  assert.equal(fits(undefined, "moss"), true); assert.equal(fits({ family: null, words: [], weight: null }, "moss"), true);
  assert.equal(fits({ family: "sdxl", words: [], weight: null }, "moss"), false);
});
test("resolveInfo caches civitai answers by name", async () => { /* in-memory db via migrate(); fake fetch counts calls; second call = 0 fetches */ });
test("lookup failure caches nothing and reports unknown", async () => { /* fake fetch rejects / 404 → {family:null,words:[],weight:null}; table stays empty */ });
```

- [ ] **Step 2: Run** `cd studio && npx tsx --test src/lib/comfy/lora-info.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lora-info.ts`. Work out each LoRA's info like this:
  1. Use the cached row if there is one.
  2. Otherwise, for a Mac file in `dir`, read its header `__metadata__` with `fromHeader`.
  3. If that gives no family or no words, look it up on civitai.red. Use the sha from `manifestSha`; for a Mac file, use a streamed `crypto.createHash("sha256")`.
  4. Merge the results: header values win, and civitai fills the gaps.
  5. Cache only when something was found.

  Other rules:
  - Words are the top 3 tags by frequency, dropping tags of one character or fewer.
  - Run the civitai lookups one after another, with a 5 s `AbortSignal.timeout`.
  - Put the token only in the `Authorization` header, and never put it in error text.
- [ ] **Step 4: Add the route.** `manifestSha` comes from `pod/comfy/models.manifest.yaml` entries with `kind: loras` (filename → sha256). Parse it the way the existing manifest reader does (grep `models.manifest` in `src/lib/comfy`). Accept at most 100 names, each passing `loraName`. The route uses the same auth as `/api/comfy/models`.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 6: Commit** `lora-info.ts`, `lora-info.test.ts`, `route.ts` and `store.ts` with the message `feat(comfy): LoRA info — family, trigger words, weight`.

### Task 2: Trigger words in the prompt

**Files:**
- Create: `studio/src/lib/comfy/triggers.ts`, `studio/src/lib/comfy/triggers.test.ts`
- Modify: `studio/src/lib/comfy/recipe.ts:8` (`Lora` gains `words?: string[]`), `recipe.ts:60` (`loras()` validator keeps `words`: array of up to 10 strings, each up to 80 chars)

**Interfaces:**
- Produces:
  - `addTriggers(prompt: string, words: string[]): { prompt: string; inserted: string[] }`. It prepends, comma-joined, the words not already present. Matching is case-insensitive and compares whole comma-separated tokens, trimmed.
  - `removeTriggers(prompt: string, inserted: string[]): string`. It removes one token for each inserted word, and tidies doubled or trailing commas and spaces.
  - `Lora.words` holds the words the studio inserted for that LoRA.

- [ ] **Step 1: Write failing tests:**

```ts
test("adds missing words in front", () => assert.deepEqual(addTriggers("sitting in a cafe", ["lenovo woman"]), { prompt: "lenovo woman, sitting in a cafe", inserted: ["lenovo woman"] }));
test("pre-typed word is neither duplicated nor removed", () => {
  const a = addTriggers("Lenovo Woman, cafe", ["lenovo woman", "detailed skin"]);
  assert.deepEqual(a, { prompt: "detailed skin, Lenovo Woman, cafe", inserted: ["detailed skin"] });
  assert.equal(removeTriggers(a.prompt, a.inserted), "Lenovo Woman, cafe");
});
test("remove leaves no stray commas", () => assert.equal(removeTriggers("a, lenovo woman, b", ["lenovo woman"]), "a, b"));
test("empty prompt", () => assert.equal(addTriggers("", ["x"]).prompt, "x"));
test("validator keeps lora words", () => { /* validatePhoto with loras:[{name,strength:0.8,words:["x"]}] keeps words */ });
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/triggers.test.ts src/lib/comfy/recipe.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `triggers.ts` and the validator change.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(comfy): insert and remove LoRA trigger words`.

### Task 3: LoraStack fit filter + auto triggers (phone and desktop)

**Files:**
- Modify: `studio/src/components/comfy/LoraStack.tsx:23-24` and list render; `studio/src/components/comfy/PhotoPane.tsx:41-45` (`pickModel`) and `:149`

**Interfaces:**
- Consumes: `LoraInfo`, `fits`, `Family` (Task 1); `addTriggers`/`removeTriggers` (Task 2); `GET /api/comfy/lora-info`.
- Produces:
  - `LoraStack` gains optional props `info?: Record<string, LoraInfo>`, `fit?: Family`, `onAdd?: (name: string) => void` and `onRemove?: (i: number) => void`.
  - When `fit` is given, the "+" list shows only names where `fits(info[n], fit)`, plus a "Show all (N hidden)" toggle that appears only when something is hidden.
  - Each LoRA row shows its trigger words as small chips.
  - Without the new props, behaviour is unchanged, so `VideoPane` needs no change.
  - PhotoPane gains `loraInfo` state, fetched when `models.loras` arrives.
  - `addLora(name)`: strength is `info.weight ?? 0.8`; calls `addTriggers(prompt, info.words)`; stores `words: inserted`; calls `onPrompt`.
  - `removeLora(i)`: calls `removeTriggers(prompt, l.words ?? [])`.
  - `pickModel` runs `removeTriggers` for every LoRA's `words` before clearing the stack.
  - The import-from-Files auto-add path in LoraStack calls `onAdd` when given.

- [ ] **Step 1:** Make the change. This is UI only; the logic is already covered by Task 1 and 2 tests.
- [ ] **Step 2: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 3: Manual check** on a temp dev server: port 3200, scratch `REPO_DIR=$S/repo`, secrets blanked (Global Constraints). Phone-width window:
  - The LoRA tool shows "Waiting for GPU…" exactly as before when the pod is off.
  - With a stubbed `/api/comfy/models` the list filters, and "Show all" reveals the rest.
  - Adding a LoRA prepends its words; removing it takes them out.
  - Kill only the PID you started.
- [ ] **Step 4: Commit** with the message `feat(comfy): LoRA list shows what fits, adds trigger words`.

### Task 4: Takes strip + desktop 4-column layout

**Files:**
- Create: `studio/src/components/comfy/useWide.ts`, `studio/src/components/comfy/TakeStrip.tsx`
- Modify: `studio/src/lib/comfy/reuse.ts` (+test in `reuse.test.ts`), `studio/src/components/comfy/PhotoPane.tsx` (render split), `studio/src/components/comfy/ComfyScreen.tsx:76` (don't cap width for Photo when wide)

**Interfaces:**
- Consumes: `reuseTarget`, `Item`, `GET /api/comfy/items`; `SwapState` slot `{ file }`; `PoseState`.
- Produces:
  - `useWide(): boolean`. It uses `matchMedia("(min-width: 1280px)")`, returns false before mount, and updates on change.
  - `restoreTake(it: Item): { recipe: PhotoRecipe; swap: { base: string; head: string } | null; pose: { kind: "depth" | "lineart"; image: string; strength: number } | null }`. It keeps the stored seed. A stored `pose` of kind `"pose"` returns `pose: null`.
    `// ponytail: skeleton keypoints aren't stored; restore pose-kind when keypoints are saved with the item.`
  - `TakeStrip({ takes, current, onRestore, onCompare }: { takes: Item[]; current: string | null; onRestore: (it: Item) => void; onCompare: (file: string | null) => void })`.
    - A vertical column of thumbnails, newest on top; it shows the newest 30 photo items.
    - Click restores the take.
    - Pointer-down held for 250 ms or longer calls `onCompare(file)`, and pointer-up calls `onCompare(null)`. The main image shows that take while the take is held. Keyboard: Enter restores; holding Space compares.
- Desktop render, at `useWide()` true:
  - Grid columns `320px 96px 1fr 300px`, height `calc(100dvh - <header>)`.
  - Column 1: model buttons, LoRA stack, prompt `<textarea>`, Pose/Swap/Tune sections as stacked panels, and a Render button with the cost note. These are the same components as the drawer, with no Drawer.
  - Column 2: `TakeStrip`.
  - Column 3: the image `object-contain`, centred, filling the column.
  - Column 4: the Task 5 `CopilotPanel` slot, which is an empty `<aside>` until Task 5.
  - The phone render is today's JSX untouched.
  - After a render finishes, prepend the new item to `takes`.

- [ ] **Step 1: Write failing tests** in `reuse.test.ts`:

```ts
test("restoreTake keeps seed, swap and depth pose", () => {
  const t = restoreTake(item("photo", { ...defaultPhoto(["q.safetensors"]), swap: { base: "b.png", head: "h.png" }, pose: { kind: "depth", image: "d.png", strength: 0.7 } }, 42));
  assert.equal(t.recipe.seed, 42); assert.deepEqual(t.swap, { base: "b.png", head: "h.png" });
  assert.deepEqual(t.pose, { kind: "depth", image: "d.png", strength: 0.7 }); assert.equal(t.recipe.pose, null);
});
test("restoreTake drops skeleton poses", () => assert.equal(restoreTake(item("photo", { ...defaultPhoto(["m"]), pose: { kind: "pose", image: "p.png", strength: 1 } })).pose, null));
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/reuse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `restoreTake`, `useWide`, `TakeStrip` and the PhotoPane split. On restore, PhotoPane does three things:
  - sets `r` and the prompt;
  - sets swap to `{ on: true, base: { file }, head: { file } }` when there is a swap;
  - sets pose to `{ ...EMPTY_POSE, kind, extracted: image, strength }`.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Manual check (Review Focus 5)** on the temp dev server:
  - At 1440px wide, the 4 columns show.
  - Drag the window below 1280px and back: the prompt, LoRAs and selected take are unchanged.
  - At 390px wide, the phone layout looks identical to production.
- [ ] **Step 6: Commit** with the message `feat(comfy): desktop Photo layout with takes strip`.

### Task 5: Miyabi copilot (chips → rule patch, her wording, Apply)

**Files:**
- Create: `studio/src/lib/comfy/tuning.ts`, `studio/src/lib/comfy/tuning.test.ts`, `studio/src/app/api/comfy/copilot/route.ts`, `studio/src/components/comfy/CopilotPanel.tsx`
- Modify: `studio/src/components/comfy/PhotoPane.tsx` (column 4)

**Interfaces:**
- Consumes: `PhotoRecipe`, `family`; `LoraInfo`; `chatStream` (`src/lib/llm.ts`); `tierModel("quick", …)`; Miyabi persona block via `chatPersona("miyabi", …)` / `activeIdentity` (as `src/lib/mascot/quip.ts` does).
- Produces:
  - `type RuleId = "face" | "plastic" | "hands" | "strong" | "pose" | "blurry"`.
  - `CHIPS: { id: RuleId; label: string }[]`, with labels exactly: "face drifted", "too plastic", "bad hands", "LoRA too strong", "wrong pose", "blurry".
  - `matchRule(text: string): RuleId | null`. Regexes:
    - face: `/face|drift|identity|look(s)? different/i`
    - plastic: `/plastic|waxy|smooth|cgi|fake/i`
    - hands: `/hand|finger/i`
    - strong: `/too strong|overcook|burn|fried|lora/i`
    - pose: `/pose|position|angle/i`
    - blurry: `/blur|soft|mushy|out of focus/i`
  - `rulePatch(id: RuleId, r: PhotoRecipe): { patch: Partial<PhotoRecipe>; change: string }`, where `change` is a plain-English list of the edits. Exact rules (strengths rounded to 0.05):
    - face: if there are LoRAs, the first LoRA gets +0.15 (cap 1.2) and the others −0.15 (floor 0.3); with no LoRAs, `faceFix: true`.
    - plastic: `cfg` −1 for sdxl, −0.5 otherwise (floor 1); prompt gets `addTriggers(prompt, ["natural skin texture", "film grain"])`.
    - hands: `steps` ×1.25 rounded, cap 60.
    - strong: every LoRA strength ×0.75.
    - pose: `seed: -1`.
    - blurry: `steps` ×1.25 (cap 60); if `hires` is null, set `hires: { scale: 1.5, denoise: 0.35 }`.
  - `safePatch(r: PhotoRecipe, p: Partial<PhotoRecipe>): Partial<PhotoRecipe>`. It keeps only the allowed fields (Global Constraints) and drops `model`. For `loras` it changes only the strength of names already in `r.loras` and never adds or removes one.
  - Route `POST /api/comfy/copilot {chip?: RuleId, text?: string, recipe: PhotoRecipe}` returns `{ say: string; rule: RuleId | null; patch: Partial<PhotoRecipe> }`.
    - The rule is `chip ?? matchRule(text)`.
    - Miyabi's line comes from the quick tier: system = persona block + "In one or two short sentences, react to what the owner said and explain this change: <change>. No tags, no lists." Collect the stream with a 20 s timeout.
    - If there's no rule, she answers the text with no patch.
    - Offline or timeout gives the canned line `Hmph, my brain's napping~ Try this: <change>`.
    - No thread, no chat history, no GPU.
  - `CopilotPanel({ recipe, onApply }: { recipe: PhotoRecipe; onApply: (p: Partial<PhotoRecipe>) => void })` shows:
    - the chip row and a text input (Enter sends);
    - her latest bubble, with an **Apply** button when `patch` is non-empty;
    - the last 6 exchanges, kept in local state only.
    - Apply calls `onApply(safePatch(recipe, patch))` against the *current* recipe and never renders.

- [ ] **Step 1: Write failing tests** in `tuning.test.ts`:

```ts
const r = { ...defaultPhoto(["sdxl.safetensors"]), cfg: 5, steps: 30, loras: [{ name: "a", strength: 0.9 }, { name: "b", strength: 0.8 }] };
test("face boosts first lora, eases others", () => assert.deepEqual(rulePatch("face", r).patch.loras, [{ name: "a", strength: 1.05 }, { name: "b", strength: 0.65 }]));
test("face without loras turns on faceFix", () => assert.deepEqual(rulePatch("face", { ...r, loras: [] }).patch, { faceFix: true }));
test("strong scales strengths", () => assert.deepEqual(rulePatch("strong", r).patch.loras, [{ name: "a", strength: 0.7 }, { name: "b", strength: 0.6 }]));
test("hands caps steps at 60", () => assert.equal(rulePatch("hands", { ...r, steps: 55 }).patch.steps, 60));
test("blurry adds hires once", () => { assert.deepEqual(rulePatch("blurry", r).patch.hires, { scale: 1.5, denoise: 0.35 }); assert.equal(rulePatch("blurry", { ...r, hires: { scale: 2, denoise: 0.3 } }).patch.hires, undefined); });
test("matchRule reads typed text", () => { assert.equal(matchRule("her face looks different"), "face"); assert.equal(matchRule("fingers are melted"), "hands"); assert.equal(matchRule("make it purple"), null); });
test("safePatch drops unknown loras and model", () => assert.deepEqual(safePatch(r, { model: "x", loras: [{ name: "a", strength: 0.5 }, { name: "gone", strength: 1 }], steps: 40 }), { loras: [{ name: "a", strength: 0.5 }, { name: "b", strength: 0.8 }], steps: 40 }));
test("offline model falls back to canned line", async () => { /* route handler core with chatStream stub that throws → say starts "Hmph, my brain's napping~", patch non-empty */ });
```

  For the offline test, export the handler core as `suggest(body, deps: { complete: (system: string, user: string) => Promise<string> })` from `tuning.ts` so the test injects a throwing `complete`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `tuning.ts`, the route (a thin wrapper around `suggest` with the real `complete`), and `CopilotPanel`. Then mount the panel in column 4 with `onApply={patch}`. Prompt edits in a patch go through `onPrompt`.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Manual check** on the temp dev server with Ollama up:
  - Tapping "LoRA too strong" gives a Miyabi line and Apply.
  - Apply lowers the strengths and does not start a render.
  - Restart the temp server with `OLLAMA_URL=http://127.0.0.1:1` and confirm the canned line appears.
- [ ] **Step 6: Commit** with the message `feat(comfy): Miyabi suggests Photo fixes you can apply`.

### Task 6: Deploy (owner approval required)

- [ ] **Step 1:** Ask the owner for deploy approval. Do not build without it.
- [ ] **Step 2:** On approval, in `studio`, run `npm run build && launchctl kickstart -k gui/$(id -u)/com.philly95.naistudio`. Then confirm `/` returns 307 and one `/_next/static/...css` chunk returns 200.
- [ ] **Step 3:** Update the memory entry `project_nai_v5_studio.md` with what was deployed.
