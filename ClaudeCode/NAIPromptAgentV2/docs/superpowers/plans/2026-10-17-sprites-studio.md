# Sprites Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, review and play animated Miyabi clips (Chat expression transitions and idles, Stage pose companion, native Mac overlay) from one clip engine on the existing ComfyUI tab.

**Architecture:** A new `studio/src/lib/sprites/` module holds the inventory (outfits, expressions, poses, edges) and a single **cell** table: an endpoint image, idle loop or transition per (surface, outfit, from, to). Cells generate through two new job kinds, `edit` (Qwen 2.1 edit) and `sprite` (Wan FLF), on the existing comfy queue. Review uses the plain mp4 takes. Only the **approved** take is cut out: ffmpeg extracts the frames, the tagger's `/cutout` removes the background, and the frames are saved as WebP with alpha. Those frame directories are the library that the Chat player, Stage player and Mac overlay read. One pure behaviour engine is written in TS; the overlay runs the same code through JavaScriptCore.

**Tech Stack:** Next.js 15 / React, better-sqlite3, sharp 0.34, ffmpeg (`/opt/homebrew/bin/ffmpeg`), tagger `/cutout` (BiRefNet ONNX), ComfyUI (Qwen Image 2.1, Smooth Mix Wan 2.2 i2v, RIFE), esbuild 0.28, Swift/AppKit + JavaScriptCore + XcodeGen for the overlay. Tests: `node:test` via `npm test`; XCTest for the overlay.

**Spec:** `docs/superpowers/specs/2026-10-17-sprites-studio-design.md`

## Global Constraints

- All paths below are relative to `studio/` unless they start with `mac/` or `docs/`.
- No age-related wording in any prompt; do not adjust negative tags for age (Miyabi is an adult).
- Never spend GPU money or Anlas without the owner's go-ahead: bulk generation shows an estimate and needs `confirm: true`. **This plan runs no GPU job.** Everything is tested against mock clients and fixture clips. §11 validation is a separate owner-approved step.
- Never print secrets (.env, tokens, keys). Never write the real `data/`: dev servers use a scratch copy (`REPO_DIR=$S/repo`). Never touch the live studio (:3000/:3100, launchd `com.philly95.naistudio`).
- Commits: only the named files, with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit`. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git add -A`/`.`, never push, never stash.
- Any model download needs the owner's explicit permission. The stock Qwen 2.1 Turbo manifest entry is **not** part of this plan; §11 decides.
- Inventory is data rows, not enums. Seeds:
  - Outfits: `day, night, lewd`.
  - Chat basic expressions (tier `tame`): `neutral, happy, laughing, pouty, annoyed, sad, surprised, sleepy`.
  - Adult expressions: `smug, blush` (tier `teasing`) and `humiliated, horny, yandere` (tier `lewd`), all tagged `adult`.
  - Starter Stage poses: `stand, look_left, look_right, look_up, face_viewer, face_away, check_nails, sit, squat, stretch_legs, lie_down, hip_pop, hair_twirl, kneel` (the last three are the "feminine poses").
- Boldness: `tame` = tier tame only; `teasing` adds tier teasing; `lewd` adds tier lewd. Stage poses tagged `lewd` are only allowed when the outfit is `lewd` **and** boldness is `lewd`.
- Clip status values: `empty | queued | generating | review | approved | rejected`. `from == to` is an idle loop.
- Default 3 takes per clip. Rejected and unpicked takes are deleted when a cell is approved; their recipe and seed stay.
- Clip timing:
  - Chat transitions 0.75 s (13 Wan frames).
  - Idles and Stage transitions 2.5 s (41 Wan frames).
  - fps 30 (RIFE ×2), size 480p portrait (480×832).
  - Bases and endpoints are 768×1344.

## Review Focus

1. **A clip is missing or still cutting when a mood or pose changes.** The player falls back to the crossfade and never shows a blank or transparent frame (Task 7, Task 9 tests).
2. **The mood changes again mid-transition.** It finishes the current transition, then chains to only the latest target, with no flash. Repeated changes collapse to one queued target (Task 7 test).
3. **An endpoint is re-approved or re-generated after its clips were approved.** Every clip touching that endpoint goes back to `empty` (stale), so mismatched seams can't stay live (Task 1 test).
4. **The server restarts or the pod dies mid-bulk.** Running and queued sprite jobs resolve through the existing comfy recovery. Cells never stay `generating` forever: status is derived from job rows, and errored jobs count as no take (Task 1 test).
5. **A library file path containing `..` or an absolute path.** The file route rejects it with 400 (Task 4 test).

---

### Task 1: Sprite store — inventory, cells, takes, derived status

**Files:**
- Create: `src/lib/sprites/store.ts`
- Test: `src/lib/sprites/store.test.ts`

**Interfaces:**
- Produces:
  - `type Surface = "chat" | "stage"`, `type Tier = "tame" | "teasing" | "lewd"`, `type Boldness = Tier`.
  - `type SpriteKey = { surface: Surface; key: string; label: string; tier: Tier; tags: string[]; prompt: string; sort: number }`.
  - `type Cell = { id: number; surface: Surface; outfit: string; from: string; to: string; approvedTake: number | null; rejected: boolean; reverse: boolean; cut: "none" | "cutting" | "done" | "error" }`.
    - `to === ""` means an endpoint image.
    - `from === "@base"` with `to === ""` means the outfit's base.
    - `from === to` means an idle.
  - `type Take = { id: number; cellId: number; jobId: number | null; itemId: number | null; seed: number; recipe: unknown }`.
  - `type CellStatus = "empty" | "queued" | "generating" | "review" | "approved" | "rejected"`.
  - Functions:
    - `migrateSprites(db)`: tables `sprite_outfits`, `sprite_keys`, `sprite_edges(a,b)` (undirected, stored with a<b), `sprite_cells` (UNIQUE surface,outfit,from_key,to_key), `sprite_takes`, plus seeds via INSERT OR IGNORE.
    - `spritesDb()`: lazy, same pattern as `comfyDb()`; also calls `migrate` from comfy store.
    - `cell(db, surface, outfit, from, to): Cell`: get-or-create.
    - Inventory: `listKeys(db, surface)`, `upsertKey(db, k)`, `removeKey(db, surface, key)`, `listOutfits(db)`, `addOutfit(db, key, label)`, `edges(db)`, `setEdge(db, a, b, on: boolean)`.
    - Takes: `addTake(db, cellId, jobId, seed, recipe): number`, `takes(db, cellId)`, `linkTakeItem(db, takeId, itemId)`.
    - Decisions: `approve(db, cellId, takeId): { dropItems: number[] }`, `reject(db, cellId)`.
    - `cellStatus(c: Cell, ts: Take[], jobStatus: (id: number) => Job["status"] | null): CellStatus`.
    - `allowedKeys(keys: SpriteKey[], boldness: Boldness, outfit: string): SpriteKey[]`.
    - `staleDependents(db, surface, outfit, key)`.

- [ ] **Step 1: Write the failing tests** in `store.test.ts`, on `new Database(":memory:")` with `migrateSprites`:

```ts
test("seeds 13 chat expressions, 14 stage poses, 3 outfits", () => {
  assert.equal(listKeys(db, "chat").length, 13);
  assert.deepEqual(listKeys(db, "chat").filter((k) => k.tier === "lewd").map((k) => k.key).sort(), ["horny", "humiliated", "yandere"]);
  assert.equal(listKeys(db, "stage").length, 14);
  assert.deepEqual(listOutfits(db).map((o) => o.key), ["day", "night", "lewd"]);
  migrateSprites(db); assert.equal(listKeys(db, "chat").length, 13); // idempotent
});
test("allowedKeys gates by boldness and lewd outfit", () => {
  const chat = listKeys(db, "chat");
  assert.equal(allowedKeys(chat, "tame", "day").length, 8);
  assert.equal(allowedKeys(chat, "teasing", "day").length, 10);
  assert.equal(allowedKeys(chat, "lewd", "day").length, 13);
  upsertKey(db, { surface: "stage", key: "spread", label: "Spread", tier: "lewd", tags: ["lewd"], prompt: "x", sort: 99 });
  const st = listKeys(db, "stage");
  assert.ok(!allowedKeys(st, "lewd", "day").some((k) => k.key === "spread"));
  assert.ok(allowedKeys(st, "lewd", "lewd").some((k) => k.key === "spread"));
});
test("cellStatus derives from takes and job rows", () => {
  const c = cell(db, "chat", "day", "happy", "sad");
  const js = new Map<number, string>();
  const st = () => cellStatus(cell(db, "chat", "day", "happy", "sad"), takes(db, c.id), (id) => (js.get(id) as never) ?? null);
  assert.equal(st(), "empty");
  addTake(db, c.id, 1, 11, {}); js.set(1, "queued"); assert.equal(st(), "queued");
  js.set(1, "running"); assert.equal(st(), "generating");
  js.set(1, "error"); assert.equal(st(), "empty");           // a dead job is no take
  const t = addTake(db, c.id, 2, 12, {}); js.set(2, "done"); linkTakeItem(db, t, 50); assert.equal(st(), "review");
  reject(db, c.id); assert.equal(st(), "rejected");
  approve(db, c.id, t); assert.equal(st(), "approved");
});
test("approve returns the other takes' items and keeps their seed rows", () => {
  const c = cell(db, "chat", "day", "neutral", "neutral");
  const a = addTake(db, c.id, 3, 1, { a: 1 }); linkTakeItem(db, a, 7);
  const b = addTake(db, c.id, 4, 2, { b: 1 }); linkTakeItem(db, b, 8);
  assert.deepEqual(approve(db, c.id, a).dropItems, [8]);
  assert.deepEqual(takes(db, c.id).map((t) => [t.seed, t.itemId]), [[1, 7], [2, null]]);
});
test("re-approving an endpoint resets clips that touch it", () => {
  const e = cell(db, "chat", "day", "happy", "");
  const clip = cell(db, "chat", "day", "happy", "sad");
  const t = addTake(db, clip.id, 9, 1, {}); linkTakeItem(db, t, 90); approve(db, clip.id, t);
  const et = addTake(db, e.id, 10, 1, {}); linkTakeItem(db, et, 91);
  approve(db, e.id, et); // endpoint approval calls staleDependents
  assert.equal(cell(db, "chat", "day", "happy", "sad").approvedTake, null);
  assert.equal(cell(db, "chat", "day", "happy", "sad").cut, "none");
});
test("edges are undirected and deduped", () => {
  setEdge(db, "sit", "stand", true); setEdge(db, "stand", "sit", true);
  assert.deepEqual(edges(db), [["sit", "stand"]]);
  setEdge(db, "stand", "sit", false); assert.deepEqual(edges(db), []);
});
```

- [ ] **Step 2: Run** `npm test -- --test-name-pattern="seeds|allowedKeys|cellStatus|approve|re-approving|edges"` and confirm it fails with module not found.

- [ ] **Step 3: Implement `src/lib/sprites/store.ts`**
  - **Seed prompts.** Each `prompt` is the Qwen edit instruction. Chat: `"same character, same outfit, same framing, plain white background; <expression description>"`. Stage: `"same character, same outfit, full body, plain white background; <pose description>"`. No age words.
  - **Seed edges** (a sparse, connected graph of 20 edges, all through `stand`/`sit`/`lie_down` hubs):

```
stand–look_left, stand–look_right, stand–look_up, stand–face_viewer, stand–face_away, stand–check_nails,
stand–hip_pop, stand–hair_twirl, stand–sit, stand–squat, sit–check_nails, sit–stretch_legs, sit–lie_down,
sit–kneel, squat–kneel, lie_down–stretch_legs, face_viewer–hip_pop, face_viewer–hair_twirl, look_left–look_right, kneel–lie_down
```

  - **Approval rules.**
    - `approve` sets `approved_take` and `rejected=0` and resets `cut` to `none`.
    - It nulls the other takes' `item_id` and returns those item ids.
    - On an endpoint cell (`to===""`, `from!=="@base"`) it calls `staleDependents(surface, outfit, from)`. That clears `approved_take` and sets `cut` to `none` on every clip cell with `from_key=? OR to_key=?`, except endpoint cells.
    - On a base cell it stales every cell of that surface+outfit.
  - **`cellStatus` order:**
    1. approved
    2. rejected (if no pending job)
    3. any take whose job is running → generating
    4. any queued → queued
    5. any take with an `itemId` → review
    6. empty
  - `parsed()`-style JSON safety for `tags` and `recipe`, like comfy store.

- [ ] **Step 4: Run the Step 2 command** and confirm PASS; then run `npm run typecheck` (clean).

- [ ] **Step 5: Commit** `src/lib/sprites/store.ts src/lib/sprites/store.test.ts`. Message: `feat(sprites): inventory + cell store with derived status`.

---

### Task 2: Edit and sprite graphs + job kinds on the comfy queue

**Files:**
- Create: `src/lib/sprites/graph.ts` (client-safe, pure)
- Modify:
  - `src/lib/comfy/store.ts:6` (JobKind)
  - `src/lib/comfy/recipe.ts:111` (wanFrames clamp)
  - `src/lib/comfy/jobs.ts` (LIMIT, `build`, `finish`)
  - `src/lib/comfy/estimate.ts`
- Test:
  - `src/lib/sprites/graph.test.ts`
  - extend `src/lib/comfy/jobs.test.ts` (or the file that tests `drainQueue`; follow its fake-client pattern)

**Interfaces:**
- Consumes: Task 1 `linkTakeItem`, `spritesDb`.
- Produces:
  - `JobKind = "photo" | "video" | "pose" | "edit" | "sprite"`.
  - `type EditPreset = "noct" | "turbo"` and `EDIT_PRESETS: Record<EditPreset, { unet: string; clip: string; sampler: { kind: "ksampler"; steps: number; cfg: number } | { kind: "sigmas"; sigmas: string } }>`:
    - noct: the Photo graph's Noct Q unet + `qwen_image_2.1_text_encoder.safetensors`, ksampler 25/3.
    - turbo: `qwen_image_2.1_turbo` int8 unet + `qwen3vl_8b` clip, sigmas `"1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0"`.
  - `type EditJob = { preset: EditPreset; base: number /* comfy item id */; prompt: string; seed: number; width: 768; height: 1344; target: { takeId: number } }`.
  - `type SpriteJob = { surface: Surface; start: number; end: number /* item ids; equal for idle */; prompt: string; seconds: number; seed: number; target: { takeId: number } }`.
  - Graph functions:
    - `editGraph(j: EditJob, image: string): object`: LoadImage → VAELoader `qwen_image_2.1_vae_bf16` → TextEncodeQwenImage21 with `image_1` + `vae`, plus EmptyLatentImage 768×1344 and SaveImage prefix `studio-edit`.
      - The `sigmas` preset uses SamplerCustomAdvanced with RandomNoise, CFGGuider cfg 1, KSamplerSelect euler and ManualSigmas.
    - `spriteRecipe(j: SpriteJob): VideoRecipe`: mode `loop` if start===end else `animate`, fps 30, size 480p, steps 8, cfg 1, motion low.
  - `secondsFor(surface: Surface, idle: boolean): number`: 0.75 for a chat transition, else 2.5.
  - `CLIP_NEGATIVE` = `DEFAULT_VIDEO_NEGATIVE` (do not add age terms).

- [ ] **Step 1: Write failing tests** in `graph.test.ts`:

```ts
test("wanFrames allows sub-second sprite clips", () => { assert.equal(wanFrames(0.75), 13); assert.equal(wanFrames(2.5), 41); assert.equal(wanFrames(0.1), 9); });
test("editGraph wires base image and vae into TextEncodeQwenImage21", () => {
  const g = editGraph({ preset: "noct", base: 1, prompt: "smiling", seed: 5, width: 768, height: 1344, target: { takeId: 1 } }, "b.png") as Record<string, any>;
  const enc = Object.values(g).find((n: any) => n.class_type === "TextEncodeQwenImage21");
  assert.ok(Array.isArray(enc.inputs.image_1) && Array.isArray(enc.inputs.vae));
  assert.equal(Object.values(g).find((n: any) => n.class_type === "LoadImage").inputs.image, "b.png");
});
test("turbo preset uses ManualSigmas + CFGGuider 1", () => {
  const g = editGraph({ preset: "turbo", base: 1, prompt: "x", seed: 5, width: 768, height: 1344, target: { takeId: 1 } }, "b.png") as Record<string, any>;
  const v = Object.values(g) as any[];
  assert.equal(v.find((n) => n.class_type === "ManualSigmas").inputs.sigmas, EDIT_PRESETS.turbo.sampler.sigmas);
  assert.equal(v.find((n) => n.class_type === "CFGGuider").inputs.cfg, 1);
});
test("spriteRecipe: idle loops, transitions animate, 30fps portrait", () => {
  assert.equal(spriteRecipe({ surface: "chat", start: 3, end: 3, prompt: "", seconds: 2.5, seed: 1, target: { takeId: 1 } }).mode, "loop");
  const t = spriteRecipe({ surface: "chat", start: 3, end: 4, prompt: "", seconds: 0.75, seed: 1, target: { takeId: 1 } });
  assert.deepEqual([t.mode, t.fps, t.size, t.steps, t.cfg], ["animate", 30, "480p", 8, 1]);
});
```

  In the jobs test file, add two tests with the existing fake client:
  - **`"edit job saves an image item and links its take"`**: queue `edit`, drain, finish with one `studio-edit_00001_.png`. Assert a `photo` item exists and `takes(db, cellId)[0].itemId` equals it.
  - **`"sprite job saves mp4 + poster and links its take"`**: the same for `sprite`, with an mp4 and a `studio-last` png.

- [ ] **Step 2: Run** `npm test` and confirm the new tests FAIL.

- [ ] **Step 3: Implement**
  - `wanFrames`: change the clamp floor from 1 s to 0.5 s. `validateVideo` still bounds user input, so the Video tab is unchanged.
  - `jobs.ts`:
    - `LIMIT.edit = 45 min`, `LIMIT.sprite = 60 min`.
    - In `build`:
      - `edit` uploads the base item's file and returns `editGraph`.
      - `sprite` uploads start/end posters-or-files exactly like the video branch and returns `videoGraph(spriteRecipe(r), { start, end, portrait: true })`, with `end` omitted when start===end.
    - In `finish`, treat `sprite` like `video` (clip) and `edit` like `photo`. Inside the existing transaction, after `addItem`: if `(j.recipe as { target?: { takeId: number } }).target`, call `linkTakeItem(d.db, target.takeId, itemId)`. Use the same `db` handle; sprite tables live in the same app db.
  - `estimate.ts`: `edit` costs like a Qwen photo at 768×1344 with the preset's step count (8 for turbo). `sprite` costs like `video` with `wanFrames(seconds)`.
  - Extend validation in `recipe.ts` with `validateEdit` and `validateSprite`. Reject non-integer ids, unknown preset, and seconds outside 0.5–3.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`; all pass.

- [ ] **Step 5: Commit** `src/lib/sprites/graph.ts src/lib/sprites/graph.test.ts src/lib/comfy/store.ts src/lib/comfy/recipe.ts src/lib/comfy/jobs.ts src/lib/comfy/estimate.ts` and the touched jobs test. Message: `feat(sprites): Qwen edit + FLF sprite job kinds`.

---

### Task 3: Generate, approve, bulk — the service layer

**Files:**
- Create: `src/lib/sprites/service.ts`
- Test: `src/lib/sprites/service.test.ts`

**Interfaces:**
- Consumes: Task 1 store, Task 2 `EditJob`/`SpriteJob`/`secondsFor`, comfy `addJob`, `estimate`, `deleteItem`, `drainQueue`.
- Produces:
  - `generate(db, cellId, n = 3, now): number[]` (job ids).
    - Base cell: needs a `from` param of the item to edit from; see `setBase`.
    - Endpoint cell: an `edit` job per take, using the approved base item of (surface, outfit).
    - Clip cell: a `sprite` job per take, using the approved endpoint items. Throws `Error("Approve both endpoints first.")` if either is missing.
    - Each take gets a fresh random seed and an `addTake` row before `addJob`.
  - `setBase(db, surface, outfit, itemId)`: makes a Library item the approved base (adds a take with `jobId: null` and approves it).
  - `deriveBase(db, surface, outfit, fromSurface, fromOutfit, prompt, n)`: edit jobs on the target base cell from another approved base (Stage from Chat; outfit swap).
  - `decide(db, cellId, { approve?: number; reject?: true; own?: boolean })`: approve deletes the dropped items with `deleteItem` and their files (the same deletion the Library DELETE route performs), then triggers `cutQueue()` (Task 4). `own` toggles `reverse`.
  - `missing(db, surface, outfit, scope: "basic" | "all"): Cell[]`:
    - Endpoints that are not approved and have no pending take, once the base is approved.
    - Clip cells whose endpoints are both approved, that are not approved, rejected or pending.
    - Chat clip cells: every ordered pair of the scoped keys, plus idles. A pair with `reverse=1` (default for the pair whose `from` sorts after `to`) is skipped; it plays its mirror backwards.
    - Stage clip cells: both directions of every edge plus an idle per pose.
  - `bulkEstimate(db, surface, outfit, scope, takes = 3): { jobs: number; seconds: number; usd: number }`.
  - `bulkStart(...)`: same args; enqueues and returns the job count.
  - `bulkCancel(db, surface, outfit)`: fails queued sprite/edit jobs of that surface+outfit with error `"Cancelled."`; running ones finish. Pause is cancel; "generate missing" resumes.

- [ ] **Step 1: Write failing tests:**

```ts
test("clip generate needs approved endpoints", () => {
  const c = cell(db, "chat", "day", "happy", "sad");
  assert.throws(() => generate(db, c.id, 3, 0), /Approve both endpoints first\./);
});
test("generate queues n sprite jobs with distinct seeds and take rows", () => {
  // helper approveEndpoint(key, itemId, surface = "chat"): setBase(db, surface, "day", 1) once, then an endpoint take with that item, approved
  approveEndpoint("happy", 10); approveEndpoint("sad", 11);
  const c = cell(db, "chat", "day", "happy", "sad");
  const ids = generate(db, c.id, 3, 0);
  assert.equal(ids.length, 3);
  const r = ids.map((id) => readJob(db, id)!.recipe as SpriteJob);
  assert.deepEqual(r.map((x) => [x.start, x.end, x.seconds]), Array(3).fill([10, 11, 0.75]));
  assert.equal(new Set(r.map((x) => x.seed)).size, 3);
  assert.equal(takes(db, c.id).length, 3);
});
test("missing chat set skips reverse pairs and counts idles", () => {
  BASIC.forEach((k, i) => approveEndpoint(k, 100 + i));              // 8 basic keys
  assert.equal(missing(db, "chat", "day", "basic").length, 8 * 7 / 2 + 8); // 28 one-way + 8 idles
});
test("missing stage set = both directions of each edge + idles", () => {
  STAGE14.forEach((k, i) => approveEndpoint(k, 200 + i, "stage"));
  assert.equal(missing(db, "stage", "day", "all").length, 20 * 2 + 14);
});
test("bulkEstimate sums per-take estimates without queuing", () => {
  const e = bulkEstimate(db, "chat", "day", "basic", 3);
  assert.equal(e.jobs, (28 + 8) * 3); assert.ok(e.usd > 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM comfy_jobs").get().n, 0);
});
test("approve deletes dropped take files", () => { /* two takes with real temp files in COMFY dir; approve one; other file gone, approved file kept */ });
test("bulkCancel fails only queued jobs of that outfit", () => { /* one queued day, one queued night, one running day */ });
```

- [ ] **Step 2: Run** `npm test` and confirm FAIL.
- [ ] **Step 3: Implement `service.ts`.** Clip prompts:
  - Chat transition: `"she changes expression from <A label> to <B label>, smooth natural motion, same character, plain white background"`.
  - Idle: `"subtle idle motion, breathing, a natural blink, slight sway, same pose, plain white background"`.
  - Stage transition: `"she moves from <A label> to <B label>, smooth natural body motion, confident teasing attitude, plain white background"`.

  The bulk estimate uses `estimate()` with the main card's `usdHr`, the same source the Video tab estimate uses. `generate` calls `void drainQueue()` after enqueueing, like the jobs route.
- [ ] **Step 4: Run** `npm test` + typecheck; PASS.
- [ ] **Step 5: Commit** `src/lib/sprites/service.ts src/lib/sprites/service.test.ts`. Message: `feat(sprites): generate/approve/bulk service`.

---

### Task 4: Cutout → library frames, and the sprites API

**Files:**
- Create:
  - `src/lib/sprites/cutout.ts`
  - `src/lib/sprites/library.ts`
  - API routes:
    - `src/app/api/sprites/route.ts` (GET studio state)
    - `src/app/api/sprites/inventory/route.ts`
    - `src/app/api/sprites/cells/[id]/route.ts`
    - `src/app/api/sprites/base/route.ts`
    - `src/app/api/sprites/bulk/route.ts`
    - `src/app/api/sprites/library/route.ts`
    - `src/app/api/sprites/library/file/[...path]/route.ts`
- Modify:
  - `src/lib/mascot/sprites.ts:175`: export `cutout`.
  - `src/lib/env.ts`: add `FFMPEG = process.env.FFMPEG || "/opt/homebrew/bin/ffmpeg"` (launchd's PATH lacks Homebrew) and `SPRITE_LIB = path.join(DATA_DIR, "mascot", "library")`.
- Test:
  - `src/lib/sprites/cutout.test.ts`
  - `src/lib/sprites/library.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `cutClip(cellId, deps: { db; dir: string /* COMFY_DIR */; lib: string; extract: (mp4: string, outDir: string) => Promise<string[]>; cut: (png: Buffer) => Promise<Buffer | null> }): Promise<void>`.
    - Writes `<lib>/<surface>/<outfit>/<from>~<to>/<n>.webp` (0-based, 3-digit) and `meta.json` `{ frames: number; fps: 30; w: number; h: number; v: number /* approved take id */ }`.
    - Frames are resized to 360 px wide (chat) or 480 px wide (stage), WebP quality 90 with lossless alpha (`alphaQuality: 100`).
    - Writes to a temp dir, then renames it into place, so a half-cut clip is never served.
    - Sets `cut` to `done`, or to `error` if any frame's cut returns null.
  - `cutQueue(): void`: a serial in-process drain over cells with `approvedTake` and `cut in ('none','cutting')`. A `globalThis` flag keeps it single-flight across bundles, like comfy's `qstate`.
  - `type LibClip = { surface; outfit; from; to; frames; fps; w; h; v; reverseOf?: string }`.
  - `type Library = { outfits: string[]; keys: SpriteKey[]; edges: [string, string][]; clips: LibClip[] }`.
  - `library(db, lib): Library`: only cells with `cut === "done"`. A reverse chat pair whose mirror is done is listed with `reverseOf: "<to>~<from>"`.
  - `safeLibPath(lib: string, parts: string[]): string | null`.
  - HTTP:
    - `GET /api/sprites` → `{ outfits, keys, edges, cells: (Cell & { status; takes: (Take & { file?: string; poster?: string })[] })[], bulk: { queued: number; running: number }, libraryBytes: number }`.
    - `POST /api/sprites/inventory` with ops `add-key | update-key | remove-key | add-outfit | edge`. Removing a key deletes its cells, takes and library dirs.
    - `POST /api/sprites/cells/:id` with `{ op: "generate", n? } | { op: "approve", takeId } | { op: "reject" } | { op: "own", on }`.
    - `POST /api/sprites/base` with `{ surface, outfit, itemId } | { surface, outfit, derive: { surface, outfit, prompt } }`.
    - `POST /api/sprites/bulk` with `{ surface, outfit, scope, confirm?: boolean, cancel?: boolean }`. Without confirm it only returns the estimate.
    - `GET /api/sprites/library` → `Library`.
    - `GET /api/sprites/library/file/...` serves a webp/json with `Cache-Control: private, max-age=31536000, immutable`. The `v` in meta busts caches through the query string `?v=`.

- [ ] **Step 1: Write failing tests**
  - In `cutout.test.ts` (fake `extract` returning 3 PNG paths made with sharp, fake `cut` returning an RGBA PNG):
    - `"cutClip writes webp frames + meta atomically"`.
    - `"a failed frame cut marks error and leaves no dir"`.
    - `"an idle drops nothing at cut time; meta.frames equals extracted count"`.
  - In `library.test.ts`:
    - `"library lists only done cells and maps reverse pairs"`.
    - `"safeLibPath rejects .. and absolute parts"`:

```ts
assert.equal(safeLibPath("/L", ["..", "x"]), null);
assert.equal(safeLibPath("/L", ["/etc", "passwd"]), null);
assert.equal(safeLibPath("/L", ["chat", "day", "happy~sad", "000.webp"]), "/L/chat/day/happy~sad/000.webp");
```

- [ ] **Step 2: Run** `npm test` and confirm FAIL.
- [ ] **Step 3: Implement.**
  - `extract`: `execFile(FFMPEG, ["-v", "error", "-i", mp4, path.join(out, "%03d.png")])`. Then list the files sorted.
  - `cut`: the exported `cutout(buf, fetch)`.
  - Routes follow the `src/app/api/comfy/*` style (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, JSON errors `{ error }` with 400/404).
- [ ] **Step 4: Verify.**
  - Run `npm test` + typecheck.
  - Then a scratch-DB dev server smoke check:
    - `S=$(mktemp -d)`, copy `data/studio.db` into `$S/repo/data/`, then `REPO_DIR=$S/repo PORT=3311 npm run dev` (note the PID).
    - `curl -s localhost:3311/api/sprites | head -c 300` shows 13 chat keys.
    - `curl -s -o /dev/null -w '%{http_code}' localhost:3311/api/sprites/library/file/..%2F..%2Fstudio.db` → `400`.
    - Kill only that PID.
- [ ] **Step 5: Commit** the created files plus `src/lib/mascot/sprites.ts src/lib/env.ts`. Message: `feat(sprites): cutout to library frames + sprites API`.

---

### Task 5: Sprites sub-tab — bases & endpoints, review grid, bulk control

**Files:**
- Create:
  - `src/components/comfy/sprites/SpritesScreen.tsx`
  - `src/components/comfy/sprites/BasesView.tsx`
  - `src/components/comfy/sprites/GridView.tsx`
  - `src/components/comfy/sprites/TakesSheet.tsx`
  - `src/components/comfy/sprites/BulkBar.tsx`
- Modify:
  - `src/components/comfy/ComfyScreen.tsx:74`: replace the disabled "Sprites — soon" button with a real `sprites` entry in `SUBS` (order Photo · Video · Sprites · Library).
  - `src/components/mascot/SpriteStudio.tsx`: add an "Open Sprites studio" link that switches to the ComfyUI tab's Sprites sub-tab, using the app's existing tab-switch mechanism (find how the tab carousel is driven and reuse it; add an `initialSub` prop to ComfyScreen if needed).
- Test: `src/components/comfy/sprites/grid.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: Task 4 HTTP API.
- Produces: `gridRows(keys: SpriteKey[], cells: CellView[], outfit: string): { from: string; cols: { to: string; cell: CellView | null }[] }[]`, exported from `src/components/comfy/sprites/grid.ts`. Its rows are chat keys in `sort` order, the diagonal is the idle, and reverse cells are flagged.

- [ ] **Step 1: Write a failing test** for `gridRows`:
  - 13×13 for chat day.
  - The diagonal is `from===to`.
  - The cell for a reverse pair carries `reverse: true`.
  - Keys added later appear (data rows).
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement the UI.**
  - **Layout:** desktop-first (`lg:` wide grid). The phone layout stays usable: the grid scrolls horizontally and the takes sheet is full-screen.
  - **SpritesScreen:**
    - Segmented controls for the view (Bases & endpoints · Grid · Pose graph (Task 6) · Library size), plus a surface toggle (Chat/Stage) and an outfit select with "Add outfit".
    - It polls `GET /api/sprites` every 4 s while anything is queued or generating, otherwise every 30 s.
  - **BasesView:**
    - Per surface+outfit: "Pick from Library" (opens the existing Library picker) → `POST base {itemId}`, plus "Derive from…" (Stage from Chat; outfit from another outfit) → edit takes.
    - Then the endpoint list with status chip, Generate, takes, approve/reject.
    - "Add expression": label + description → `add-key` with tier select.
  - **GridView:**
    - Chat: a `gridRows` matrix. Stage: a list of edges (both directions) plus idles.
    - Every cell with a take shows `<video muted loop playsInline autoPlay>` of the approved or first take's mp4, or the poster image when `prefers-reduced-motion` is set. A status chip uses the six status words.
    - A reverse cell renders its mirror's approved clip with an "↺ reverse" badge and a "Generate own" action (`op: "own"`).
  - **TakesSheet:** the takes side by side, looping in sync (restart all on open). Buttons: "Use this" (approve), "Reject all", "More takes".
  - **BulkBar:**
    - "Generate missing" with scope Basic/All. It first calls bulk without confirm and shows `"<jobs> clips · ~<h> h · ~$<usd>"` with a Confirm button (confirm: true).
    - It shows progress (`bulk.queued/running`) and a Cancel button.
  - Copy uses plain words. Everything else follows the existing comfy component style (Night Studio tokens).
- [ ] **Step 4: Verify.**
  - Run `npm test` + typecheck + `npm run lint` (if defined).
  - Scratch dev server as in Task 4: open `http://localhost:3311` in the browser tools, go to ComfyUI → Sprites, and screenshot Bases and Grid at 1440 px and 390 px widths.
  - No console errors.
  - No GPU is involved: the grid shows empty cells.
- [ ] **Step 5: Commit** the created files plus `ComfyScreen.tsx` and `SpriteStudio.tsx`. Message: `feat(sprites): Sprites sub-tab — bases, grid, takes, bulk`.

---

### Task 6: Pose graph editor

**Files:**
- Create: `src/components/comfy/sprites/PoseGraphView.tsx`, `src/components/comfy/sprites/layout.ts`
- Test: `src/components/comfy/sprites/layout.test.ts`

**Interfaces:**
- Consumes:
  - Task 4 `inventory` ops: `add-key` for surface stage with tags, and `edge` with `{a, b, on}`.
  - Task 3 via the cells route: "generate missing" for one pose = its endpoint, then its idle and edge clips.
- Produces: `circleLayout(keys: string[], w: number, h: number): Record<string, { x: number; y: number }>`, a deterministic circle with `stand` at the top.

- [ ] **Step 1: Write a failing test.** `circleLayout` places N keys on a circle inside the box, is deterministic, and puts `stand` at the top-centre when present.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement the editor.**
  - An SVG of nodes (each showing its pose endpoint thumbnail or label) and edges.
  - Drag from one node to another toggles an edge; click an edge to remove it (pointer events, works with touch).
  - The side panel shows the selected pose: tags as toggle chips (`tease, rest, lewd, reaction`, plus free text), tier select, the edit description, endpoint status + Generate, and "Generate missing for this pose" (its endpoint, its idle, and the clips on its edges whose other endpoint is approved, n=3 each; shows the estimate first, like BulkBar).
  - "Add pose": label + description → `add-key`.
- [ ] **Step 4: Verify.** Run `npm test` + typecheck. On the scratch server, add a pose, connect it to `sit`, and screenshot. Confirm the edge persists after reload.
- [ ] **Step 5: Commit** the created files. Message: `feat(sprites): pose graph editor`.

---

### Task 7: Chat portrait player (replaces warp per outfit)

**Files:**
- Create:
  - `src/lib/sprites/player.ts` (pure)
  - `src/components/mascot/ClipPortrait.tsx`
  - `src/lib/sprites/useLibrary.ts` (fetch `/api/sprites/library`; refetch on `mascot:sprites`)
- Modify:
  - `src/components/mascot/PortraitStage.tsx`: render `ClipPortrait` when the library has the current outfit's chat idle for the current expression. Otherwise keep the existing path, warp included, until that outfit is covered (spec §13.1).
  - `src/lib/mascot/core.ts`: the quip expression list comes from chat `SpriteKey`s. `parseQuip` accepts any provided key and maps legacy keys through `LEGACY = { wink: "smug", pout: "pouty", flirty: "horny", shocked: "surprised", excited: "happy" }` (`smug`, `laughing`, `annoyed` and `sleepy` keep their names).
  - `src/lib/mascot/quip.ts`: pass the key list.
- Test: `src/lib/sprites/player.test.ts`

**Interfaces:**
- Consumes: Task 4 `Library`, `LibClip`.
- Produces:
  - `type Seg = { clip: LibClip; reversed: boolean; loop: boolean }`.
  - `type PlayerState = { at: string; seg: Seg | null; startedAt: number; pending: string | null }`.
  - Functions:
    - `route(lib: Library, surface: Surface, outfit: string, from: string, to: string): Seg | "crossfade"`: an own clip, else the mirror reversed, else `"crossfade"`.
    - `request(s: PlayerState, to: string, lib, outfit, now): PlayerState`.
    - `tick(s, lib, outfit, now): PlayerState`.
    - `frameAt(s, now): { clip: LibClip; index: number } | null`.
  - `dropLoopSeam(n)`: idles play frames `0..n-2`, because the first frame equals the last.

- [ ] **Step 1: Write failing tests:**

```ts
test("route prefers own clip, then mirror reversed, else crossfade", ...);
test("request during a transition queues only the latest target", () => {
  let s = request(idleAt("happy"), "sad", lib, "day", 0);     // starts happy→sad
  s = request(s, "annoyed", lib, "day", 100); s = request(s, "sleepy", lib, "day", 200);
  assert.equal(s.pending, "sleepy");
});
test("tick chains pending transition from the arrival expression, then idles", () => {
  // after happy→sad ends, the next seg is sad→sleepy (or crossfade), then sleepy idle loop
});
test("missing transition yields crossfade and lands on target idle", ...);
test("frameAt never returns an index past the last frame; idle wraps at n-1", ...);
test("parseQuip maps legacy expression keys", () => { assert.equal(parseQuip("[wink] hi", keys).expression, "smug"); });
```

- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement.**
  - **ClipPortrait:**
    - Draws on a canvas at the display size.
    - Frames load as `ImageBitmap`s through `createImageBitmap(blob, { resizeWidth })`. It keeps only the current idle and the active transition decoded.
    - On `mascot:react`, it fetches the transition's frames. If they aren't decoded within 400 ms it uses a crossfade between the two idles' first frames instead (no blank frame). The canvas keeps the previous frame until the next one is ready.
    - `prefers-reduced-motion`: it shows idle frame 0 and switches expression with a crossfade.
    - It keeps PortraitStage's talk overlay behaviour (`talkFrame`) unchanged.
- [ ] **Step 4: Verify.**
  - Run `npm test` + typecheck.
  - Fixture check: generate fake clips with `node scripts/sprite-fixtures.mjs $S/repo/data/mascot/library`, a tiny script (create it in `scripts/`) that writes 3 coloured, numbered sharp frames per clip plus `meta.json` and marks the cells `cut=done` in the scratch DB.
  - On the scratch server, trigger moods from Chat. The screen recording (gif_creator) shows idle → transition → idle with no blank frame.
- [ ] **Step 5: Commit** the created and modified files plus `scripts/sprite-fixtures.mjs`. Message: `feat(sprites): animated Chat portrait player`.

---

### Task 8: Behaviour engine (pure, shared)

**Files:**
- Create: `src/lib/sprites/behaviour.ts`, `scripts/build-behaviour.mjs`
- Modify: `package.json`: add `"build:behaviour": "node scripts/build-behaviour.mjs"`. The script uses esbuild to bundle behaviour.ts as an IIFE with global `Behaviour` into `../mac/MiyabiOverlay/Resources/behaviour.js`.
- Test: `src/lib/sprites/behaviour.test.ts`

**Interfaces:**
- Consumes: Task 1 `allowedKeys`, `SpriteKey`; Task 4 `Library`.
- Produces:
  - `type Ev = { type: "tick" } | { type: "poke" } | { type: "dragStart" } | { type: "drop" } | { type: "typing" } | { type: "sysIdle" } | { type: "sysActive" }`.
  - `type BState = { pose: string; since: number; lastUser: number; pokes: number[]; nextDrift: number; asleep: boolean; dragging: boolean }`.
  - `type Act = { pose: string; quip?: "poke" | "tease" | "make_me" | "finally" | "ignored"; look?: "cursor" }`.
  - `step(s: BState, ev: Ev, ctx: { lib: Library; outfit: string; boldness: Boldness; now: number; rand: () => number }): { s: BState; act: Act | null }`.
  - `path(edges: [string, string][], from: string, to: string): string[]` (BFS, inclusive).
  - `toJSONStep(json: string): string`: the JSON-in/JSON-out wrapper used by the overlay, exported on `Behaviour`.

  Rules, from spec §7 and the plan's timings:
  - Drift every 20–60 s to a linked pose tagged `rest` or untagged.
  - Ignored ≥ 5 min (no poke/typing/sysActive): a target tagged `tease`.
  - Ignored ≥ 15 min: `tease` or `lewd`, filtered by `allowedKeys`.
  - Poke: a pose tagged `reaction`, quip `poke`. The 3rd poke within 10 s gives quip `make_me` and a `tease` pose.
  - `dragStart`: pose `dangle` if that key exists, else hold the current pose. `drop`: `sit`.
  - `typing`: `look: "cursor"`, at most once per 30 s.
  - `sysIdle`: `lie_down` then asleep. `sysActive` while asleep: quip `finally` and pose `stand`.
  - Moves to a non-neighbour target return the next hop of `path`. The player handles a missing clip as a crossfade.

- [ ] **Step 1: Write failing tests**, each with a seeded `rand` and fixed `now`:
  - `"drifts within 20–60 s to a neighbour"`.
  - `"no move before nextDrift"`.
  - `"escalates to tease after 5 min ignored"`.
  - `"lewd poses need lewd outfit and lewd boldness"`.
  - `"third poke in 10 s says make_me"`.
  - `"drop settles into sit"`.
  - `"sysIdle sleeps; sysActive wakes with finally"`.
  - `"path walks the graph; non-neighbour target returns next hop"`.
  - `"toJSONStep round-trips"`.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement** `behaviour.ts` with no DOM or Node imports, and the esbuild script (`format: "iife"`, `globalName: "Behaviour"`, `platform: "neutral"`).
- [ ] **Step 4: Run** `npm test` + typecheck. Then run `npm run build:behaviour`; `../mac/MiyabiOverlay/Resources/behaviour.js` exists and `node -e "eval(require('fs').readFileSync('../mac/MiyabiOverlay/Resources/behaviour.js','utf8')); console.log(typeof Behaviour.toJSONStep)"` prints `function`.
- [ ] **Step 5: Commit** `src/lib/sprites/behaviour.ts src/lib/sprites/behaviour.test.ts scripts/build-behaviour.mjs package.json ../mac/MiyabiOverlay/Resources/behaviour.js`. Message: `feat(sprites): shared behaviour engine`.

---

### Task 9: In-app Stage player

**Files:**
- Modify:
  - `src/components/mascot/Stage.tsx`: when the library has an approved Stage idle for the current outfit, drive the pose from `behaviour.step` and draw through the Task 7 player with `surface: "stage"`. Otherwise keep today's pose path.
  - `src/lib/mascot/settings.ts` (type + parse; `settings.test.ts` for the test): add `boldness: Boldness` to MascotSettings, default `"teasing"`, plus a select in `MascotSettings.tsx`.
- Test: extend `src/lib/sprites/player.test.ts`

**Interfaces:**
- Consumes: Task 7 `route/request/tick/frameAt` (surface-agnostic), Task 8 `step`, the existing quip call Stage makes today.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write a failing test.**
  - **`"stage route follows next hop; missing edge clip crossfades"`**: a Library with `stand~sit` approved but not `sit~lie_down`. Requesting `lie_down` from `stand` plays `stand~sit` and then crossfades.
  - Add a settings parse test: an unknown boldness value falls back to `"teasing"`.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement.**
  - Poke on canvas pixels uses the existing `classifyBodyGesture` (`poke`/`pat` → `poke` Ev).
  - Ticks run every 1 s while the Stage is visible (pause on `visibilitychange`).
  - A quip from an `Act` reuses Stage's existing quip request with the event name.
  - Mac-only events are never sent here.
- [ ] **Step 4: Verify.** Run `npm test` + typecheck. Scratch server with stage fixtures (extend `sprite-fixtures.mjs` with a `--stage` flag): a 90 s recording shows at least one drift through a transition, and a poke reaction.
- [ ] **Step 5: Commit** the modified files. Message: `feat(sprites): Stage companion on the behaviour engine`.

---

### Task 10: Native macOS overlay (Swift/AppKit)

**Files:**
- Create in `mac/`:
  - `mac/project.yml` (XcodeGen; macOS 15 deployment, app target `MiyabiOverlay`, test target `MiyabiOverlayTests`, bundle id `com.philly95.miyabiOverlay`, team `9TL96DXFPC`, `LSUIElement = YES`, sign to run locally)
  - App sources in `mac/MiyabiOverlay/`:
    - `App.swift`
    - `OverlayWindow.swift`
    - `ClipPlayer.swift`
    - `LibraryClient.swift`
    - `Behaviour.swift` (JSContext wrapper over `Resources/behaviour.js`)
    - `Keychain.swift`
    - `MenuBar.swift`
    - `Activity.swift`
    - `HitTest.swift`
  - Tests in `mac/MiyabiOverlayTests/`:
    - `HitTestTests.swift`
    - `BehaviourTests.swift`
    - `LibraryClientTests.swift`
    - `PlacementTests.swift`
  - `mac/CLAUDE.md`: copy the relevant parts of `ios/CLAUDE.md` (build via xcode-runner, never raw xcodebuild in the main thread).

**Interfaces:**
- Consumes: Task 4 `GET /api/sprites/library` + file route; `POST /api/auth/login` (`{ password }` → session cookie); `POST /api/mascot/quip` with the same body Stage.tsx sends; Task 8 `behaviour.js` (`Behaviour.toJSONStep`).
- Produces:
  - `HitTest.alphaAt(_ image: CGImage, _ p: CGPoint) -> CGFloat`.
  - `Placement.home(screen: CGRect, visible: CGRect, size: CGSize) -> CGPoint`: bottom-right corner just above the Dock (the `visibleFrame` bottom), 24 pt margin.
  - `LibraryClient.sync(base: URL) async throws -> Library`:
    - Caches meta and frames under `~/Library/Application Support/MiyabiOverlay/library/` keyed by `v`.
    - Offline, it returns the cached library.

- [ ] **Step 1: Write failing XCTests:**
  - `alphaAt` returns 0 on a transparent pixel and ≈1 on an opaque one. Out of bounds returns 0.
  - `Placement.home` keeps the window fully inside `visibleFrame`.
  - `Behaviour` loads `behaviour.js` from the bundle. `step` with a `poke` event returns a JSON `act` with `quip`, mirroring the TS test.
  - `LibraryClient`, against a `URLProtocol` stub:
    - parses the Library JSON
    - writes the cache
    - a second call with the network failing returns the cached value
    - a 401 response surfaces `.needsLogin`
- [ ] **Step 2: Run** the tests through the `xcode-runner` agent (`xcodegen generate` in `mac/`, then the test scheme) and confirm FAIL.
- [ ] **Step 3: Implement.**
  - **OverlayWindow:**
    - Borderless, `isOpaque = false`, `backgroundColor = .clear`, `level = .floating`, `collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]`.
    - `sharingType = .none`.
    - A 30 Hz timer sets `ignoresMouseEvents = alphaAt(currentFrame, mouseInView) < 0.1`.
    - Dragging sends `dragStart`/`drop` events.
  - **ClipPlayer:** loads WebP frames with `CGImageSourceCreateWithURL`. It follows the same seg rules as Task 7: reverse, idle seam drop, and a crossfade on a missing clip via a `CABasicAnimation` on `contents`.
  - **Activity:**
    - Every 1 s, `CGEventSourceSecondsSinceLastEventType(.combinedSessionState, .keyDown) < 1` sends `typing`. Using this API avoids the Input Monitoring permission.
    - Any-event idle > 300 s sends `sysIdle`; activity after that sends `sysActive`.
  - **Screen share:** besides `sharingType = .none`, poll `CGSessionCopyCurrentDictionary()` for `"CGSSessionScreenIsShared"` every 2 s and hide while it is true.
  - **MenuBar** (`NSStatusItem`): Show/Hide, Boldness (Tame/Teasing/Lewd), Mute bubble, Outfit, Server URL + password (stored with `Keychain` as the session cookie; the password is never stored), Quit.
  - **Bubble:** a small `NSPanel` above her with the quip text, auto-hidden after 5 s, suppressed when muted.
- [ ] **Step 4: Verify.**
  - Tests pass through `xcode-runner`.
  - Build the app (Debug) through `xcode-runner`, then **ask the owner before launching it**. With the owner's OK, run it against the scratch dev server with fixtures:
    - She appears bottom-right above the Dock.
    - Clicks pass through transparent pixels.
    - A poke triggers a reaction.
    - The menu bar works.
    - Starting a QuickTime screen recording hides her.
  - Record the results in the commit message body.
- [ ] **Step 5: Commit** everything under `mac/` except build products (add `mac/.gitignore` with `build/`, `*.xcodeproj/xcuserdata`, and `MiyabiOverlay.xcodeproj` since XcodeGen generates it). Message: `feat(overlay): native Miyabi desktop overlay`.

---

## After this plan (owner-gated, not tasks)

- **§11 validation** (~$0.10–1, owner go-ahead):
  1. Generate a Chat base, then edit 3 expressions with `noct`. If identity drifts, ask to add the Turbo model to the manifest (download permission) and retry with `turbo`.
  2. Run 3 Stage pose edits.
  3. Make one FLF transition and one idle, approve them, and check the cutout and playback in iOS Safari and the overlay.
  4. Settle reverse play: if a reversed clip looks wrong, flip the chat default to `reverse=0`.
- Bulk generation per outfit, through BulkBar's estimate + confirm.
- Once all three outfits have approved Chat idles, delete the warp/old-sprite path (`anim.ts` WARP, old `poses.ts`/`clips.ts` users) in a cleanup change.
- Deploy: the owner runs `! launchctl kickstart -k gui/$(id -u)/com.philly95.naistudio`.
