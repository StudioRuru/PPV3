# Mascot animation — Plan 22 (sub-project C, layers 1 + 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (owner's choice). Steps are TDD for logic: write the named tests, watch them fail (record it), implement, pass, commit.

**Goal:** Miyabi (roaming stage + Chat portrait) and Aru (shop portrait) get always-on idle life (WebGL mesh warp), crossfaded frame swaps, hop-step locomotion, blink/talk/reaction frame clips generated with NovelAI, and a Clips tab in the sprite studio.

**Architecture:** Pure logic in `studio/src/lib/mascot/anim.ts` (band deformation, springs, hop path) and `clips.ts` (clip kinds, ClipPlayer state machine, manifest + path validation, request builders); NovelAI `infill` added to `lib/nai-body.ts` beside the existing img2img; clip files under each profile's sprite dir served by the sprite route; `components/mascot/SpriteCanvas.tsx` (raw WebGL, no new dependency) replaces the `<img>` in Stage and PortraitStage with an `<img>` fallback.

**Tech stack:** Next.js 16, React, WebGL 1, node:test via tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-mascot-animation-design.md` (approved). Layer 3 (video clips) is out of scope.

## Global constraints
- Branch `anim`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push; git root is HOME — never `git add -A`/`.`; never `git stash`.
- No live NovelAI/Ollama/tagger calls in tests; no dev server unless the controller runs it on a scratch DB copy; never write the real `data/`.
- Generation stays free-tier: ≤ 1 Mpx, ≤ 28 steps (same sizes as the base sprite); estimate → one confirm → sequential → Stop → stop on first error → nothing replaced on failure. Never send upscaled/oversized sources (existing guard).
- Clip kinds and frame counts: `blink` 1 (inpaint eyes, tags `closed eyes`), `talk` 2 (inpaint mouth: `open mouth, talking` small then wide — frame tags `parted lips` / `open mouth`), reactions via img2img from the base sprite — `laugh` 3 (strength 0.45, `laughing, closed eyes, open mouth`), `pout` 3 (0.40, `pout, puffed cheeks`), `wink` 3 (0.40, `one eye closed, smile`), `wave` 4 (0.50, `waving, hand up` → `waving, hand to side` alternating), `jump` 4 (0.55, `jumping, arms up` / `midair` / `landing, knees bent` / `standing`). Same seed within a clip; base sprite's own prompt (look tags + framing) is the starting prompt, with the clip tags appended; UC = the base sprite's UC.
- Inpaint: NovelAI `action: "infill"` with `image` (base PNG), `mask` (PNG, white = repaint), model = the inpainting variant of the configured model (implementer confirms the exact model id/params from existing NovelAI client code/docs without live calls; the controller verifies with ONE free live call during Task 5). If V5 inpainting is unavailable, ruling in advance: blink/talk fall back to img2img at strength 0.30 with the same tags.
- Mask defaults (normalised to the base sprite box): busts/talk portraits — eyes {x .32, y .30, w .36, h .10}, mouth {x .40, y .44, w .20, h .08}; full-body poses — eyes {x .42, y .10, w .16, h .04}, mouth {x .45, y .14, w .10, h .03}. Owner can nudge per base sprite; stored in the manifest.
- Files: `<spriteDir>/clips/<baseKey>/<kind>/<n>.png` (+ candidates under `<spriteDir>/candidates/clips/...`) and `<spriteDir>/clips/<baseKey>/manifest.json` = `{ masks?: {eyes?, mouth?}, clips: { <kind>: { frames: number, fps: number, loop: boolean } } }`. `baseKey` must be an existing listing key (bust `outfit/expr`, `pose/...`, `talk/...`), encoded path-safely; kind ∈ the 7 kinds; frame index whitelisted. Aru via `?profile=aru` as today.
- Runtime: one rAF per visible SpriteCanvas, paused when off-screen/hidden; mesh 16×24; bands per spec (head/hair y < 0.3 sway; chest 0.3–0.55 breathe; whole-body springs; drag lag); crossfade 80–160 ms; reduced motion → no warp/crossfade; WebGL failure/context loss → `<img>` fallback for that instance. Talk clip ~8 fps; blink every 2.5–6 s (not when empty slime); empty slime: breathing only, dimmed.
- Playback priorities: talk > reaction > blink > idle; one-shot reactions return to the current expression frame.

## Review focus
1. Never breaks the mascot: missing/partial clips, a WebGL failure, a lost context, or reduced motion always leave a correct still image; no blank canvas.
2. Performance on the phone: one rAF loop per visible canvas, no per-frame allocations or layout reads, textures uploaded once per frame image, loops stop when hidden/unmounted.
3. Frame registration: clip frames align to the base sprite (same canvas size/anchor) so swaps don't jump; crossfades hide small drift.
4. Spend safety and untrusted input in the clip pipeline (confirm, Stop, stop-on-error; baseKey/kind/frame whitelist; mask values clamped 0–1).
5. Talk sync: talk frames run only while a reply streams and stop cleanly on end/error/reset/thread switch.

---

### Task 1: Animation + clip brain (pure)
**Files:** Create `studio/src/lib/mascot/anim.ts`, `anim.test.ts`, `studio/src/lib/mascot/clips.ts`, `clips.test.ts`.
**Produces:**
- `anim.ts`: `type WarpState = { t: number; sway: number; breathe: number; squash: Spring; drag: { vx: number; vy: number } }`; `bandFor(pose, v)`; `vertexOffset(u, v, s: WarpState, pose): [dx, dy]` (pure, normalised units); `type Spring`, `kick(spring, impulse)`, `stepSpring(spring, dt)` (damped, settles); `hopPath(from, to, dist → hops 2–4): Array<{ t: number; x: number; y: number; squash: number; tilt: number }>`.
- `clips.ts`: `CLIP_KINDS`, `CLIP_SPEC` (frames/fps/loop/method/strength/tags per kind — values from Global constraints), `type Manifest`, `validateManifest(raw)`, `clipPath(dir, baseKey, kind, n)` / `manifestPath(dir, baseKey)` (whitelist, traversal-safe), `defaultMasks(baseKey)`, `clampMask(m)`, `clipRequests(base: { compiled, params }, kind, seed)` → per-frame `{ compiled, params, img2img?: { strength }, infill?: true }`; `ClipPlayer`: pure state machine `init()`, `play(state, kind, now)`, `tick(state, now) → { kind | null, frame | null }`, priorities and return-to-expression, missing kinds ignored, empty slime → no clips.
**Tests:** spring settles; vertex offsets zero outside bands and bounded inside; reduced amplitude for lie/sit uses x-bands; hop counts by distance, endpoints exact, squash at take-off/landing; manifest validation (bad kinds, frames > spec, negative fps rejected); path whitelist/traversal; default masks per key type; clampMask; clipRequests strength/tags/seed per kind; ClipPlayer priority (talk pre-empts reaction, reaction pre-empts blink), one-shot return, loop until stop, missing clip → still.
Commit: `feat(anim): animation and clip brain`.

### Task 2: Clip pipeline (server)
**Files:** Modify `studio/src/lib/nai-body.ts` (+ test: `Infill` type `{ image; mask }`, `action: "infill"`, inpainting model id, `mask` param; img2img unchanged; oversized-source guard applies), `studio/src/lib/mascot/sprites.ts` (save clip candidates / pick → cutout + align to base canvas → write frame; read/write manifest; listing gains `clips` per base key: `{ <baseKey>: { <kind>: frames } }`), `studio/src/app/api/mascot/sprites/...` route (serve clip frames `clips/<baseKey>/<kind>/<n>` + candidates, `?profile=aru`), `studio/src/app/api/mascot/studio/route.ts` (actions `clip-estimate`, `clip-generate` (confirm required), `clip-pick`, `clip-masks` (save nudged masks)); tests with temp dirs and a fake NovelAI fetch.
- Mask PNG built server-side from the normalised box at the base sprite's size (white box on black), pure helper + test (dimensions, box placement).
- Alignment: cutout frames are composited onto a transparent canvas of the base sprite's exact size at (0,0) — reuse the existing cutout path; if sizes differ (shouldn't), scale to fit and log.
Commit: `feat(anim): NovelAI clip pipeline`.

### Task 3: SpriteCanvas + playback in the app
**Files:** Create `studio/src/components/mascot/SpriteCanvas.tsx` (WebGL 1: grid mesh, vertex shader applying `vertexOffset` math on GPU (port of anim.ts formulas, kept in sync with a shared constants object), two textures + mix uniform for crossfade, `<img>` fallback, visibility pause, context-loss handling); Modify `studio/src/components/mascot/Stage.tsx` (render SpriteCanvas; hop-step moves via `hopPath`; squash kicks on poke/drop/land; drag lag), `studio/src/components/mascot/PortraitStage.tsx` (SpriteCanvas; talk clip frames while phase = talk (fallback to existing talk_open/talk_closed portrait frames); blink; reactions), `studio/src/components/mascot/Mascot.tsx` (fetch listing incl. clips; trigger reactions per spec table: poke → laugh/pout by mood, pat → wink, flick/drop → pout, generated/upscaled/vial_drop → jump or wave), `studio/src/components/ChatScreen.tsx` + `ApothecarySheet.tsx` only for passing talk/reaction hooks if PortraitStage can't infer them from phase.
- One shared ClipPlayer per rendered character instance; rAF only in SpriteCanvas.
- Tests for any new pure helpers (e.g. talk frame pacing from stream chunks); `npm run build` must pass.
Commit: `feat(anim): living sprites in the app`.

### Task 4: Studio Clips tab
**Files:** Modify `studio/src/components/mascot/SpriteStudio.tsx` (+ helpers/tests in `lib/mascot/ui.ts`): new kind tab **Clips** for both profiles → pick a base sprite (grid of existing sprites) → kind rows with frame thumbnails + a looping preview (SpriteCanvas) → "Make clips for this sprite" / "…for all sprites of this outfit" (missing kinds only) with one confirm (count + estimate), sequential, Stop, stop on first error; per-kind redo with candidate pick; mask nudge editor (drag eye/mouth boxes over the sprite, Save → `clip-masks`).
- Helper tests: missing clip cells per sprite/outfit, batch ordering.
Commit: `feat(anim): clips tab in the sprite studio`.

### Task 5: Verify, review, ship
- `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Controller live check on a scratch DB copy: ONE free live inpaint call to confirm the infill request shape (apply the img2img fallback ruling if it fails); generate a blink + talk + one reaction for one bust and one pose; idle warp smooth at phone width; talk during a real Chat reply; reaction on poke; hop moves; reduced-motion fallback; WebGL-off fallback (force via a query flag or devtools).
- Final whole-branch review (Opus) with the Review focus; one fix wave; merge `anim` → main (ff); `npm run deploy`. iOS app unchanged (no rebuild needed).
