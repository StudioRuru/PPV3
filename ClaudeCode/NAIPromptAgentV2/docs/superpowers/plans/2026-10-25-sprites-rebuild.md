# Sprites Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sprites makes poses again, and every frame and clip shows one consistent Miyabi. Two LoRAs trained on fresh NovelAI renders of her drive this: one for the pose model, one for Wan clips.

**Architecture:**
1. A training-set generator renders her through the app's NovelAI client. Each render gets its own caption, made from her tags minus her identity tags, plus the trigger `miyabi_sprite`.
2. The owner picks about 40 renders in a Sprites panel. Those picks feed the existing AI-Toolkit trainer, which gains two new arches: the pose family (MOSS or Klein 4B) and Wan 2.2 I2V.
3. The Sprites pose step moves off Qwen 2.1 onto a family-driven ReferenceLatent edit graph with her image LoRA.
4. Sprite clips go to 720p, with her Wan LoRA and the trigger word.

**Tech Stack:** Next.js 16 studio (`studio/`), better-sqlite3, sharp, node:test via `npx tsx --test`, ComfyUI API graphs, AI-Toolkit on the main pod, NovelAI via `src/lib/novelai.ts`.

**Spec:** `docs/superpowers/specs/2026-10-25-sprites-rebuild-design.md` (approved 2026-10-25, f7fc87f)

## Global Constraints

**Spending and approvals**
- No GPU time, Anlas or download without the owner saying yes *for that batch*. Every gate in "Run order" is a stop-and-ask.
- No age wording in any prompt or caption. Negative tags are not adjusted ("she's 100% adult").
- Existing approved sprites stay until the owner approves a replacement set. Nothing is deleted.
- Model lookups go through civitai.red only. Downloads need the filename, source and size stated, plus approval. Only AI-Toolkit and Impact Pack may be installed on the pod.

**Secrets**
- Never print the NovelAI token, `.env` contents or any key.

**Build, test and deploy**
- No `next build` in the live studio dir except during an approved deploy.
- Temp dev servers use a scratch DB copy (`REPO_DIR=$S/repo`) with every secret blanked: `NOVELAI_TOKEN= APP_PASSWORD= HYPERSTACK_API_KEY= COMFY_TS_AUTHKEY= HF_TOKEN= CIVITAIRED_KEY=`.
- Never write to the real `data/`.

**Git**
- Commit only the named files, with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`.
- End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No `git add -A`, push, stash or branch switching.

**Names and values**
- Trigger word: `miyabi_sprite`.
- LoRA names: `miyabi_sprite_img` (pose family) and `miyabi_sprite_wan` (Wan 2.2 I2V).
- Training set: about 90 renders, the owner picks 5–40 (the existing `MIN_IMAGES` / `MAX_IMAGES`).
- Clips: `size: "720p"`, `steps: 8`, `cfg: 1`. Clip lengths are unchanged.
- Wan LoRA: rank 32, resolution [512, 768].

## Review Focus

1. **LoRA missing on the pod.** Generating a pose or clip before her LoRA exists on the pod should say "Train Miyabi's LoRA first", not fail inside ComfyUI. Covered in Task 4 (`missingSpriteLoras`).
2. **Training-set run interrupted.** If the app restarts mid-run, renders already saved are kept and the next run continues numbering instead of overwriting. Covered in Task 3 (`nextIndex`).
3. **Identity tag shared with an expression.** "fang" is both an identity tag and in several expressions. Captions drop only exact identity tags from the identity part, and keep the expression's own copy. Covered in Task 3 (`captionFor`).
4. **Pick count out of range.** Training from fewer than 5 or more than 40 picks is refused with the existing message. Covered in Task 3 (route test).
5. **Bulk estimate.** At 720p the bulk estimate grows to match, so the owner approves the real minutes and cost. Covered in Task 5 (`bulkEstimate` test).

---

### Task 1: Pod recon (gate G1)

**Gate G1:** Ask the owner to start the main pod for read-only recon, about 15 minutes. Nothing trains, renders or downloads here.

**Files:**
- Create: `docs/superpowers/notes/2026-10-25-sprites-recon.md`

**Interfaces:**
- Produces the values Tasks 2, 4 and 5 copy in:
  - **Trainer arch strings.** `AIT_ARCH.moss` (or `null` if AI-Toolkit has no MOSS type), `AIT_ARCH.klein`, `AIT_ARCH.wan22`. Plus any extra config keys each arch needs, such as Wan's high/low expert switches.
  - **Training base paths.** `BASE.moss` / `BASE.klein` / `BASE.wan22`.
  - **Downloads still needed,** each with filename, source and size.
  - **LoRA output filenames.** Especially whether the Wan run writes one file or a `high_noise` / `low_noise` pair.
  - **Pose graph nodes.** Whether `ReferenceLatent` and `VAEEncode` exist in `object_info`, and the exact class names for the Klein loaders/latent if Klein is used.
  - **`POSE_FAMILY` decision.** `"moss"` if `AIT_ARCH.moss` is set, else `"klein"`.

- [ ] **Step 1:** Over the existing pod SSH path, search the AI-Toolkit source for its model types. Example: `grep -rniE "moss|klein|flux2|wan22|i2v" /opt/ai-toolkit/toolkit /opt/ai-toolkit/extensions_built_in --include='*.py' -l`. Then read the model registry and the example configs under `/opt/ai-toolkit/config/examples/` for Klein and Wan 2.2 I2V.
- [ ] **Step 2:** Run a read-only `GET /object_info/ReferenceLatent` and `/object_info/CLIPLoader` on the pod's ComfyUI. Record whether `moss_image` is a CLIPLoader type and whether ReferenceLatent is present.
- [ ] **Step 3:** Write the recon note with every value listed in Interfaces. Commit it as `docs(sprites): pod recon for the rebuild`.
- [ ] **Step 4:** Ask the owner to stop the pod.

### Task 2: Trainer — new arches, per-image captions, multi-file results

**Files:**
- Modify: `studio/src/lib/comfy/train.ts`
- Test: `studio/src/lib/comfy/train.test.ts` (extend it, or create it if it doesn't exist)

**Interfaces:**
- Consumes the Task 1 note.
- Produces:
  - `type Arch = "sdxl" | "qwen" | "moss" | "klein" | "wan22"`.
  - `AIT_ARCH: Record<Exclude<Arch, "sdxl">, string>`, with the values from the recon note.
  - `export const POSE_FAMILY: "moss" | "klein"`, taken from the recon note's decision.
  - `startTrain({ name, arch, kind, images, captions? }: { …existing; captions?: string[] })`. When `captions` is given, it must match `images` in length, and image *i* gets `captions[i]` as its `.txt`. Otherwise the existing `caption(kind, trigger)` is used.
  - `trainStatus` copies **every** final `*.safetensors` in the run's output dir, not intermediate step saves. This covers a Wan high/low pair.

- [ ] **Step 1: Write failing tests.**

```ts
test("wan22 config: rank 32, 512–768", () => {
  const c = buildConfig({ name: "miyabi_sprite_wan", arch: "wan22", kind: "face" } as any);
  assert.equal(c.config.process[0].network.linear, 32);
  assert.deepEqual(c.config.process[0].datasets[0].resolution, [512, 768]);
  assert.equal(c.config.process[0].model.arch, AIT_ARCH.wan22);
});
test("pose arches use their AIT arch", () => {
  for (const a of ["moss", "klein"] as const) assert.equal(buildConfig({ name: "miyabi_sprite_img", arch: a, kind: "face" } as any).config.process[0].model.arch, AIT_ARCH[a]);
});
test("per-image captions must match image count", () => assert.throws(() => captionFiles(["a.png", "b.png"], ["x"]), /caption/));
test("per-image captions pair by index", () => assert.deepEqual(captionFiles(["a.png", "b.png"], ["x", "y"]), [["a.txt", "x"], ["b.txt", "y"]]));
test("final loras: step checkpoints are skipped", () => assert.deepEqual(finalLoras(["m_000500.safetensors", "m_high_noise.safetensors", "m_low_noise.safetensors", "m.yaml"]), ["m_high_noise.safetensors", "m_low_noise.safetensors"]));
```

  Adjust `buildConfig`'s argument shape to its real signature. The assertions stay.
- [ ] **Step 2:** Run `npx tsx --test src/lib/comfy/train.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `captionFiles(images: string[], captions: string[]): [string, string][]` and `finalLoras(files: string[]): string[]` (drop names matching `/_\d{6}\.safetensors$/`).
  - Add the new `BASE` / `STEPS` entries from the recon note. Starting values: `STEPS.moss = STEPS.klein = 1500` and `STEPS.wan22 = 2000`, each with a `ponytail:` comment saying to tune from the first run.
  - Wan uses rank 32 and resolution [512, 768]. The other arches keep the current values.
  - If `AIT_ARCH.moss` is null in the recon note, leave `moss` out of `Arch`.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `train.ts` and its test as `feat(train): MOSS/Klein/Wan arches, per-image captions`.

### Task 3: Training-set generator, picker and train-from-picks

**Files:**
- Create:
  - `studio/src/lib/sprites/trainset.ts`
  - `studio/src/lib/sprites/trainset.test.ts`
  - `studio/src/app/api/sprites/trainset/route.ts`
  - `studio/src/components/sprites/TrainSet.tsx`
- Modify:
  - `studio/src/app/api/comfy/train/route.ts`, to accept `trainset: true` in place of uploaded images.
  - The Sprites screen, to mount `TrainSet` as a collapsible "Training set" panel.

**Interfaces:**
- Consumes:
  - `MascotSettings` (`charTags`, `constantTags`, `layerTags`, `exprTags`) from `src/lib/mascot/settings.ts`.
  - `generateImage`, `measured` from `src/lib/novelai.ts`.
  - `DEFAULT_PARAMS` from `nai-body.ts`.
  - `startTrain({…, captions})` from Task 2.
- Produces:
  - `SHOTS = ["portrait", "upper body", "cowboy shot", "full body"]` and `ANGLES = ["straight-on", "from side", "three quarter view", "from above"]`.
  - `type TrainRender = { i: number; outfit: Outfit; tags: string; caption: string }`.
  - `trainsetRenders(s: MascotSettings, start: number, n: number): TrainRender[]`.
    - Render *i* rotates through outfit `OUTFITS[i % 3]`, expression `EXPRESSIONS[i % 9]`, shot `SHOTS[⌊i/3⌋ % 4]` and angle `ANGLES[⌊i/12⌋ % 4]`.
    - Tags = charTags, constantTags, layer, expression, shot, angle, then `simple background, white background`.
  - `captionFor(s: MascotSettings, outfit, expr, shot, angle): string`. It is `miyabi_sprite, ` + constantTags, layer, expression, shot and angle. charTags are never included.
  - `nextIndex(files: string[]): number`. One past the highest `NNN.png`, or 0 if there are none.
  - Storage: `DATA_DIR/trainset/miyabi/NNN.png` + `NNN.txt`, with picks in `picked.json` (an array of indices).
  - Route `/api/sprites/trainset`:
    - `GET` → `{ renders: {i, picked}[], spent: number }`.
    - `POST {n}` renders the next *n* (max 100) one after another and returns `{ made, spent }`.
    - `POST {pick: i, on: boolean}` sets a pick.
  - `POST /api/comfy/train` with `trainset: true` reads the picks and their `.txt` captions and sends them as `images` + `captions`. It keeps the existing 5–40 check, the pod-ready check and `freeVram`.

- [ ] **Step 1: Write failing tests** in `trainset.test.ts`. Use the defaults from `settings.ts`.

```ts
test("caption drops identity, keeps expression's own fang", () => {
  const c = captionFor(S, "day", "smug", "portrait", "straight-on");
  assert.ok(c.startsWith("miyabi_sprite, "));
  assert.ok(!c.includes("hoshimi miyabi") && !c.includes("red eyes"));
  assert.ok(c.includes("smirk") && c.includes("fang"));
});
test("renders cover all outfits and expressions in 90", () => {
  const r = trainsetRenders(S, 0, 90);
  assert.equal(new Set(r.map((x) => x.outfit)).size, 3);
  assert.equal(new Set(r.map((x) => x.tags.split(", ").find((t) => SHOTS.includes(t)))).size, 4);
});
test("no age words anywhere", () => trainsetRenders(S, 0, 90).forEach((x) => assert.doesNotMatch(x.tags + x.caption, /\b(loli|child|young|teen|petite|aged?)\b/i)));
test("nextIndex resumes after the highest render", () => { assert.equal(nextIndex([]), 0); assert.equal(nextIndex(["000.png", "007.png", "007.txt", "picked.json"]), 8); });
test("train route refuses 4 picks", async () => { /* route core with 4 picked → 400 with the existing MIN_IMAGES message */ });
```

  For the route test, export the pick-to-payload step as `picksPayload(dir): Promise<{ images: Buffer[]; captions: string[] }>` and assert the existing range error before `startTrain` is called.
- [ ] **Step 2:** Run `npx tsx --test src/lib/sprites/trainset.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `trainset.ts` and the routes.
  - The lewd outfit renders with rating `nsfw`; the others use `safe`.
  - Each render goes through `measured(token, …)`, and its cost adds to `spent` in a `spent.json`.
  - **The UI panel (`TrainSet.tsx`):**
    - A **Render 1 (price check)** button shows the measured cost × 90.
    - A **Render the rest** button stays disabled until the price check has run.
    - A tap-to-pick thumbnail grid shows the count `n/40`.
    - **Train image LoRA** and **Train Wan LoRA** buttons post `trainset: true` with names `miyabi_sprite_img` / `miyabi_sprite_wan` and arches `POSE_FAMILY` / `wan22`.
    - These buttons are disabled unless picks are between 5 and 40 and the pod is ready.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Manual check** on a temp dev server with secrets blanked:
  - The panel renders.
  - Render 1 fails cleanly with the no-token message, and no Anlas is spent.
  - Pick toggles persist in the scratch `data/`.
- [ ] **Step 6:** Commit these files as `feat(sprites): NovelAI training set + picker → trainer`.

### Task 4: Pose step on the new model with her LoRA

**Files:**
- Create: `studio/src/lib/sprites/loras.ts`
- Modify:
  - `studio/src/lib/sprites/graph.ts` (replace `EDIT_PRESETS` noct/turbo and `editGraph`)
  - `studio/src/lib/sprites/service.ts` (default preset; replace the `"noct"` literals)
  - The sprites generate/bulk routes, for the missing-LoRA check.
- Test: `studio/src/lib/sprites/graph.test.ts`

**Interfaces:**
- Consumes `POSE_FAMILY` from `train.ts` (Task 2) and the Task 1 note (node names, LoRA output filenames).
- Produces:
  - In `loras.ts`:
    ```ts
    SPRITE_LORAS = {
      trigger: "miyabi_sprite",
      image: { name: "miyabi_sprite_img.safetensors", strength: 0.9 },
      wan: [{ name: "<high file>", strength: 1, expert: "high" }, { name: "<low file>", strength: 1, expert: "low" }],
    }
    ```
    - Use the filenames from the recon note. If the Wan run writes a single file, `wan` is one entry with no `expert`.
    - Strengths carry `ponytail:` comments saying to tune them from the cheap tests.
  - `missingSpriteLoras(available: string[]): string[]`. Generate and bulk routes return 409 `"Train Miyabi's LoRA first"` when it is non-empty.
  - `POSE: { unet, clip, clipType, vae, latent, steps, cfg }`, one preset for `POSE_FAMILY`.
    - MOSS uses the `DIT.moss` values from `recipe.ts`.
    - Klein uses the recon note's filenames, with a `ponytail:` comment saying they are unverified until downloaded.
  - `type EditPreset = "pose"`. `EditJob` is otherwise unchanged.
  - `editGraph(j: EditJob, image: string)` chains these nodes:
    - UNETLoader → LoraLoaderModelOnly(`SPRITE_LORAS.image`), CLIPLoader(`clip`, `clipType`), VAELoader;
    - CLIPTextEncode(`miyabi_sprite, ` + prompt);
    - LoadImage(base) → VAEEncode → ReferenceLatent(conditioning, latent);
    - KSampler on an empty `latent` at `width × height`, then VAEDecode → SaveImage.
  - Negative stays the existing text, unchanged.

- [ ] **Step 1: Write failing tests.**

```ts
test("pose graph loads her LoRA and references the base", () => {
  const g = editGraph({ preset: "pose", base: "b.png", prompt: "smug", seed: 1, width: 768, height: 1344, target: "x" } as EditJob, "b.png");
  const nodes = Object.values(g) as any[];
  assert.ok(nodes.some((n) => n.class_type === "LoraLoaderModelOnly" && n.inputs.lora_name === SPRITE_LORAS.image.name));
  assert.ok(nodes.some((n) => n.class_type === "ReferenceLatent"));
  assert.ok(nodes.some((n) => n.class_type === "CLIPTextEncode" && n.inputs.text.startsWith("miyabi_sprite, ")));
});
test("missing LoRA is named", () => assert.deepEqual(missingSpriteLoras([]), [SPRITE_LORAS.image.name, ...SPRITE_LORAS.wan.map((w) => w.name)]));
```

  Remove `EDIT_PRESETS` outright.
- [ ] **Step 2:** Run `npx tsx --test src/lib/sprites/graph.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as described in Interfaces. In `service.ts`, change the `preset = "noct"` defaults and the `bulkEstimate` / `bulkStart` literals to `"pose"`.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS. Old sprite tests that assert noct presets get updated to `"pose"`, not deleted.
- [ ] **Step 5:** Commit as `feat(sprites): pose step on MOSS/Klein with Miyabi LoRA`.

### Task 5: Quality clips — 720p, her Wan LoRA, trigger

**Files:**
- Modify:
  - `studio/src/lib/sprites/graph.ts` (`spriteRecipe`)
  - `studio/src/lib/sprites/service.ts` (clip prompts)
  - `studio/src/lib/comfy/recipe.ts` (`Lora.expert?`, `videoGraph`)
- Test: `studio/src/lib/sprites/graph.test.ts`, `studio/src/lib/comfy/recipe.test.ts`

**Interfaces:**
- Consumes `SPRITE_LORAS` (Task 4).
- Produces:
  - `Lora` gains `expert?: "high" | "low"`. `videoGraph` chains a LoRA onto only that expert's unet when `expert` is set, and onto both when unset (today's behaviour).
  - `spriteRecipe(j)` returns `size: "720p"` and `loras: SPRITE_LORAS.wan`, with `steps: 8`, `cfg: 1` and `fps: 30` unchanged.
  - Every Chat, Stage and idle clip prompt in `service.ts` starts with `miyabi_sprite, `.

- [ ] **Step 1: Write failing tests.**

```ts
test("sprite clips are 720p with her Wan LoRA", () => {
  const r = spriteRecipe(job);
  assert.equal(r.size, "720p"); assert.equal(r.steps, 8); assert.equal(r.cfg, 1);
  assert.deepEqual(r.loras, SPRITE_LORAS.wan);
  assert.ok(r.prompt.startsWith("miyabi_sprite, "));
});
test("expert LoRA lands on one unet only", () => {
  const g = videoGraph({ ...vid, loras: [{ name: "h.safetensors", strength: 1, expert: "high" }] });
  const l = (Object.values(g) as any[]).filter((n) => n.class_type === "LoraLoaderModelOnly");
  assert.equal(l.length, 1);
});
test("unscoped LoRA still lands on both", () => { /* same with no expert → 2 loaders */ });
test("bulk estimate reflects 720p", () => { /* bulkEstimate on a fixture db with one missing clip cell; seconds ≈ estimate(720p) × takes, > the 480p figure */ });
```

- [ ] **Step 2:** Run `npx tsx --test src/lib/sprites/graph.test.ts src/lib/comfy/recipe.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in Interfaces.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit as `feat(sprites): 720p clips with Miyabi Wan LoRA`.

### Task 6: Deploy (gate G2)

- [ ] **Step 1:** Ask the owner to approve the deploy.
- [ ] **Step 2:** Run `npm run build && launchctl kickstart -k gui/$(id -u)/com.philly95.naistudio`.
- [ ] **Step 3:** Check that `/` returns 307 and a CSS chunk returns 200.
- [ ] **Step 4:** Confirm Sprites shows "Train Miyabi's LoRA first" rather than an error, and that the old approved sprites still play.

## Run order after deploy (each step is a separate owner yes)

| Gate | What | Spends |
|---|---|---|
| G3 | Training set "Render 1": price check, then "Render the rest" (about 90) | Anlas (shown first) |
| — | Owner picks about 40 in the panel | nothing |
| G4 | If `POSE_FAMILY = "klein"`: download the Klein 4B base and its encoder (names, source and sizes from the recon note) | download |
| G5 | Image LoRA training. If MOSS, start with a short trial (about 300 steps) and judge 3 test poses by eye. If the trial fails, fall back to G4 (Klein). | pod time |
| G6 | Wan 2.2 I2V training base download (from the recon note), then the Wan LoRA training run | download, then pod time |
| G7 | Cheap tests: render one new `@base` (Photo + LoRA, then adopt it via the existing set-base), 3 poses, and 2 clips. One clip uses the trigger and one doesn't, made in the Video tab with the same LoRA. Tune strengths in `loras.ts` if needed. | pod time |
| G8 | Per surface × outfit: new `@base`, then a bulk batch, with the 720p estimate shown | pod time |

The old sprites stay until the owner approves each new set.
