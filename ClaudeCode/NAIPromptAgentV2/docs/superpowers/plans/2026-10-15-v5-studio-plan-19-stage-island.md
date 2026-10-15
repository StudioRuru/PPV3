# Mascot stage & liquid island — Plan 19 (sub-project 9, P1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (owner's choice). Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** Miyabi becomes a full-body, many-pose actor who roams the screen, gets in the way on purpose and reacts to touch; the bottom tab bar is replaced by a liquid "Dynamic Island" pill (from the owner's SwiftUI sample) plus a tab carousel in Miyabi's tap menu.

**Architecture:** Pure logic in `studio/src/lib/mascot/` (pose catalogue + request builder + fallback chain, stage behaviour chooser, stage gesture classifier, island state/gesture machine) with tests; the existing studio routes/sprites extend to a `pose` art kind; `components/mascot/Stage.tsx` replaces the floating bust in `Mascot.tsx` (quips/bubble logic kept); `components/LiquidIsland.tsx` (SVG goo filter) replaces `TabBar`.

**Tech stack:** Next.js 16, React, CSS + Web Animations API (no new deps), node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-mascot-stage-nav-chat-design.md` §1 (poses), §2, §3 (P1 only; §4–5 are P2/P3).

## Global constraints
- Branch `stage`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push; git root is HOME — never `git add -A`.
- No live NovelAI/Ollama/tagger calls in tests; no dev server unless the controller runs it on a scratch DB copy; never write the real `data/`.
- Poses: `stand`, `lie`, `apose`, `peek`, `lean`, `sit`, `legs`, `back`. Sizes: stand/apose/peek/lean/back 832×1216, lie 1216×832, sit/legs 1024×1024; 28 steps (free on Opus). Back view: one sprite per outfit (no expression).
- Pose files: `<spriteDir>/pose/<pose>/<outfit>/<expression>.png` and `<spriteDir>/pose/back/<outfit>.png` (+ `.orig.png`), whitelisted names only.
- Fallback chain: pose+expression → same pose `smug` → `stand` same expression → `stand/smug` → bust → placeholder.
- Stage never covers a focused input or the island; while typing she ducks to the nearest edge (peek); she sits under sheets (z below `.sheet`) and above content.
- Mischief slider 0–10 (mascot setting `mischief`, default 5); 0 = parks at an edge, moves only when poked.
- Island defaults from the sample: anchor 126×37.33 pt at top 11 pt centred; hot zone 180×65; expanded drawer 340×150; drag thresholds expand > 55, collapse < −30; spring response 0.45 / damping 0.72; goo blur ≈12, alpha threshold ≈0.5. Calibration settings `island: { x, y, w, h }` (offsets from defaults, validated, Reset).
- Tabs: Studio · Camera roll · Closet · Chat · RP · Settings (Settings opens the existing SettingsSheet). The bottom `TabBar` is removed; edge-swipe between tabs is kept.

## Review focus
1. Never blocks input: focused inputs, composers (`[data-composer]`) and the island are never covered; typing ducks her; a stuck drag/gesture always releases (pointercancel, blur).
2. Gesture disambiguation on her body and the island (tap vs poke vs pat vs drag vs flick vs swipe-off vs long-press; swipe vs drag on the island) — no misfires, no double actions.
3. Performance: animations use transform/opacity only; the goo filter only on the small island layer; no layout thrash from the behaviour loop; listeners cleaned up.
4. Recoverability: hidden Miyabi always summonable (island long-press, Settings); navigation always reachable without Miyabi (island, edge-swipe).
5. Sprite studio scale: generating many pose sprites never spends without a confirm; per-pose/per-outfit "Generate missing" stops on first error; existing bust flow unaffected.

---

### Task 1: Pose catalogue + sprite pipeline
**Files:** Create `studio/src/lib/mascot/poses.ts`, `poses.test.ts`; Modify `studio/src/lib/mascot/sprites.ts` (art kind `pose`, `spriteRequest` for poses, paths, `target()` whitelist, listing incl. poses), `studio/src/app/api/mascot/sprites/route.ts` + `[outfit]/[expr]` route (or a new `pose/[pose]/[outfit]/[expr]` route) to serve pose sprites, `studio/src/app/api/mascot/studio/route.ts` (estimate/generate/pick for poses), tests.
**Produces:** `POSES`, `type Pose`; `POSE_SPEC: Record<Pose, { tags: string; width: number; height: number; faced: boolean }>` (framing tags per pose, e.g. lie: `lying on stomach, full body, from side, chin on hands`; back: `from behind, back view, full body, hands on hips, looking at screen` — exact wording is the implementer's, tested for presence of the pose key words + `simple background, white background`); `poseRequest(outfit, pose, expr | null, settings, seed)`; `posePath(dir, pose, outfit, expr | null)`; `pickPoseSprite(have: Set<string>, pose, outfit, expr): string | null` (fallback chain per Global constraints).
**Tests:** sizes per pose; back has no expression and uses its own path; request composes char + constant + layer + pose tags (+ expression tags when faced) with full-body UC excluded; fallback chain order; traversal rejected; listing includes pose sprites.
Commit: `feat(stage): pose sprites`.

### Task 2: Sprite studio — poses
**Files:** Modify `studio/src/components/mascot/SpriteStudio.tsx` (+ small helpers in `lib/mascot/ui.ts`).
Kind switch (Busts / Poses); in Poses: pose picker (8 chips with an aspect icon), outfit tabs, 3×3 expression grid (back: a single cell per outfit), candidate pick as today; "Generate missing for this pose" (all outfits×expressions of the pose) and "…for this outfit" (all poses), each with one up-front confirm showing count + estimate, sequential, stop on first error, Stop button. Helper tests for missing-cell lists over poses.
Commit: `feat(stage): pose studio`.

### Task 3: Stage brain (pure)
**Files:** Create `studio/src/lib/mascot/stage.ts`, `stage.test.ts`.
**Produces:**
- `type Spot = { pose: Pose; x: number; y: number; flip: boolean; scale: number }` (viewport coordinates of her anchor).
- `chooseSpot(ctx: { vw; vh; mischief; avoid: Rect[]; targets: Rect[] /* cards/images she can sit on or lean against */; event?: "generate" | "idle" | "bored" | "sheet" | "typing"; rand }): Spot` — rules per spec §2 (generate → back view facing the image; typing → peek at the nearest edge; idle/bored → stand/lie/sit/legs/apose by weights; mischief scales how central/obstructive she is); never intersects `avoid` (inputs, composers, island).
- `nextMoveDelay(mischief, rand)`: 20–90 s scaled (mischief 0 → Infinity).
- `classifyBodyGesture(samples)` → `"poke" | "pat" | "drag" | "flick" | "swipeOff" | "menu" | "longpress" | null` (pat = tap in the top 20% of her box; menu = first tap when not poked within 1.5 s… define clearly; flick = release speed > threshold; swipeOff = flick ending off-screen).
- `blinkSchedule(rand)` and `idleMood(…)` small helpers.
**Tests:** each rule incl. avoid-rects never intersected, typing → edge peek, generate → back view, mischief 0 → parked + no auto moves, gesture thresholds (table-driven), deterministic with injected rand.
Commit: `feat(stage): behaviour + gesture brain`.

### Task 4: Stage component
**Files:** Create `studio/src/components/mascot/Stage.tsx`; Modify `studio/src/components/mascot/Mascot.tsx` (render Stage instead of the bust when pose sprites exist; keep the bust as the fallback; keep quip/bubble/speak gate/events), `studio/src/app/page.tsx` (provide targets/avoid rects via data attributes: `[data-mascot-target]` on the latest image/cards, `[data-composer]` and focused inputs as avoid), `studio/src/app/globals.css` (keyframes).
- Positioned layer, size from pose aspect × setting S/M/L; moves with spring transforms; flips; microinteractions per spec §2 (poke jiggle + expression, pat, drag with flail + settle, flick bounce + sulk, swipe-off hide 10 min with a line, scroll sway, sheet peek, generate → turn around then quip on done); blink via brief `sleepy` swap; tap → menu (tab carousel: Studio · Camera roll · Closet · Chat · RP · Settings, swipeable, tap to go) plus existing long-press menu items (hush, outfit) moved into it.
- Pointer events only on her painted box (pointer-events on the img with an alpha hit-test fallback = bounding box is fine); `data-noswipe`.
Commit: `feat(stage): full-body Miyabi on stage`.

### Task 5: Liquid island navigation
**Files:** Create `studio/src/lib/mascot/island.ts` (+ test: state machine minimal/compact/expanded, gesture classifier swipe-left/right/down/up/tap/long-press with the sample's thresholds, drag→size mapping), `studio/src/components/LiquidIsland.tsx`; Modify `studio/src/app/page.tsx` (remove `<TabBar>`, mount `<LiquidIsland tab onTab …>`, reclaim bottom padding; scroll-direction collapse), `components/mascot/MascotSettings.tsx` + `lib/mascot/settings.ts` (`mischief`, `island` calibration with validation + Reset), `components/TabBar.tsx` (delete or leave unused — delete if no other users).
- SVG `<filter>` goo (blur → alpha threshold) on a small fixed layer with the anchor capsule and the drawer rect; text/buttons rendered on top without the filter; spring via WAAPI.
- Minimal/compact/expanded contents per spec §3; expanded includes tab grid, Hide/Summon Miyabi, Mischief slider.
- Non-island devices (top safe-area inset < 50 px): plain dark pill at the top with the same states/gestures.
Commit: `feat(stage): liquid island navigation`.

### Task 6: iOS shell check
**Files:** `ios/App/StudioApp.swift` only if needed.
Verify the WKWebView frame is pinned to the view edges (not the safe-area layout guide) so page content draws under the island (viewport-fit=cover and `contentInsetAdjustmentBehavior = .never` are already set). If it's pinned to the safe area, change it to the edges; then the owner rebuilds via `ios/build.sh` (the controller asks first — device install).
Commit (only if changed): `fix(ios): web view draws under the Dynamic Island`.

### Task 7: Verify, review, ship
- `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Controller live check on a scratch DB at phone width: stage renders with placeholders/bust fallback and with a couple of test pose files copied in the scratch dir; moves; poke/drag/flick; typing ducks; island minimal/compact/expanded via mouse drags; tab switching; hide/summon; no covering of inputs.
- Final whole-branch review (Opus) with the Review focus; one fix wave; merge `stage` → main (ff); `npm run deploy`.
