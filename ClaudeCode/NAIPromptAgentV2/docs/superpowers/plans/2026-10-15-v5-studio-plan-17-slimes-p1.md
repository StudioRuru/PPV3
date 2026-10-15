# Personality sliders & slimes — Plan 17 (sub-project 8, P1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (owner's choice for plan 16) or superpowers:executing-plans. Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** Five sliders (brat, bimbo, hypnosis, heat, length) with caps shape Miyabi's quips and deep talk; her whole identity (voice, name, sliders, toggles, look, memories) lives in personality slimes on an unlockable shelf, which can be extracted, removed (→ Empty), inserted, mixed (with jars or a Blank) and made from RP characters.

**Architecture:** Pure logic in `studio/src/lib/mascot/slime.ts` (doc types/validation, slider tiers, length shape, drift, mix maths, empty block) with tests; persistence + identity switching in `slime-store.ts` (table `mascot_slimes`, active id setting, syncing memories/look between the active jar and the live mascot tables/settings); one `activeIdentity()` server helper that the quip path and the deep-talk chat route both read; API under `/api/mascot/slimes`; UI: a Personality panel, a sheet popover and the Shelf.

**Tech stack:** Next.js 16, better-sqlite3, node:test via tsx (`cd studio && npm test`), Ollama (E4B quick, APEX heavy via `heavyGate`).

**Spec:** `docs/superpowers/specs/2026-10-15-slimes-sliders-apothecary-design.md` (§1, §2, §4, §5; §3 Apothecary is P2).

## Global constraints
- Branch `slimes`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push. The git root is the HOME dir — never `git add -A`.
- No live NovelAI/Ollama/tagger calls in tests; no dev server unless the controller runs it on a scratch DB copy; never write the real `data/` or `data/studio.db` from tests.
- Sliders are integers 0–10 with `cap` 0–10 and `cap ≥ value`; drifted (`live`) values never exceed the cap and reset to `value` on slime load or when the owner moves a slider.
- Slime text enters prompts as quoted data with caps: voice ≤ 1500 chars, name/selfName ≤ 40, ≤ 12 facts × 160, journal snapshot ≤ 50 rows.
- Mix voice-merge and RP distill run on the heavy tier inside `heavyGate.run` with `think:false`; failures save nothing.
- First run must turn today's Miyabi into jar #1 (active) without losing her voice, toggles, look tags, facts, journal or sprites.
- The active jar can't be deleted; Remove → Empty first.

## Review focus
1. Identity switching is lossless: extract/remove/insert round-trips voice, sliders (value/cap/live), mods, look tags, sprite dir, facts and journal exactly; a crash mid-switch leaves either the old or the new identity (transaction), never a mix.
2. Empty state really is empty: no Miyabi voice, sliders or drift leak into quips/deep talk while no jar is inserted; drift is a no-op when Empty.
3. Mix: ratio 10–90 enforced; slider value/cap blend stays integer, ≤10 and cap ≥ value; dominant look/sprite dir; memories merged + capped; APEX failure saves nothing.
4. RP extract: card text quoted as data, voice capped, sliders 0 / caps 10, no memories; missing card → readable error.
5. Prompt size: slider directives + voice + facts stay within the existing quip/deep-talk budgets (quip num_ctx 4096).

---

### Task 1: Slime core (pure)
**Files:** Create `studio/src/lib/mascot/slime.ts`, `slime.test.ts`.

**Produces:**
- `SLIDERS = ["brat","bimbo","hypnosis","heat","length"] as const`; `type SliderId`; `type Slider = { value: number; cap: number; live?: number }`; `type Sliders = Record<SliderId, Slider>`.
- `type SlimeDoc = { name; color /* #rrggbb */; voice; selfName; sliders: Sliders; mods: Modifiers; heatDrift: boolean; look: { charTags; constantTags; layerTags: Record<Outfit,string>; exprTags: Record<Expression,string>; spriteDir: string /* relative to data/mascot, "" = default */ }; memories: { facts: string[]; journal: { kind; summary; line; created_at }[] }; vials: unknown[] /* P2 */; origin: string }`.
- `validateSlime(raw: unknown): SlimeDoc | null` (caps per Global constraints; integers; cap ≥ value; colour regex; unknown keys dropped).
- `sliderBlock(s: Sliders): string` — tier text per slider from its effective level (`live ?? value`), "" at 0; bimbo/hypnosis tier text reuses the bodies in `lib/rp/mods.ts` (import or extract the tier arrays — do not duplicate prose); brat and heat 5 tiers each per spec §1.
- `lengthShape(level: number): { sentences: string; quipPredict: number; talkPredict: number }` — 0–3 → "one short burst" / 60 / 250; 4–6 → "1–2 sentences" / 120 / 500; 7–10 → "a 3–5 sentence tantrum" / 220 / 900.
- `driftSlider(s: Sliders, event: "idle" | "dislike", heatDrift: boolean): Sliders` — brat live +1 (≤ cap); heat live +1 only when `heatDrift`; others unchanged.
- `resetLive(s: Sliders): Sliders`; `setSlider(s, id, { value?, cap? }): Sliders` (clamps, cap ≥ value, clears live).
- `mixSliders(a, b, ratioA /* 10–90 */): Sliders` (round to integers, keep cap ≥ value); `mixMemories(dominant, other)` (dominant first, dedupe, caps).
- `EMPTY_BLOCK`: flat/monotone/obedient persona text; `emptyLines` (canned removal/insertion lines for when the model is unavailable).
- `blankSlime(): SlimeDoc` (empty voice, all sliders 0 / cap 10).

**Tests:** validation caps/rejections; every slider tier at 0/1/5/10 (empty at 0, distinct text); bimbo/hypnosis text comes from rp/mods; lengthShape bands; drift: idle bumps brat to cap and stops, heat only with toggle, reset/set clears live; mix at 10/50/90 incl. rounding and cap ≥ value; memories merge caps; blank slime validates.

Commit: `feat(slimes): slime core`.

### Task 2: Slime store, first run, identity switching
**Files:** Create `studio/src/lib/mascot/slime-store.ts`, `slime-store.test.ts`; Modify `studio/src/lib/db.ts` (call `migrateSlimes(db)` after `migrateMascot`).

**Produces:** `migrateSlimes(db)` (table `mascot_slimes(id INTEGER PK, doc TEXT, created_at, updated_at)`; meta key `active_slime`); `class SlimeStore(db, live: LiveIdentity)` where `LiveIdentity` is an injected adapter over the live mascot state (`read(): { voice; selfName; sliders; mods; heatDrift; look; memories }` and `write(identity | null)` — production adapter in Task 3 uses mascot settings + MascotStore facts/journal; tests use an in-memory fake).
- `list()`, `get(id)`, `activeId()`, `ensureFirstRun()` (if no jars: snapshot the live identity as jar "Miyabi", colour `#b7a4ff`, origin "miyabi", mark active; idempotent).
- `extract(name, color)` → new jar from the live identity (live slider values kept as `live`).
- `remove()` → snapshot live into the active jar, set active null, `live.write(null)` (Empty). Returns the removed jar.
- `insert(id)` → if a jar is active, snapshot it first; then `live.write(doc with resetLive)`, set active. One transaction.
- `save(id, patch)` (rename/recolour/sliders/voice via validateSlime), `remove`-guarded `delete(id)` (refuses the active jar).
- `create(doc)` for mix/RP results.

**Tests:** first run idempotent and lossless (fake live state round-trips); extract → insert another → insert back restores everything incl. live sliders reset to value; remove → Empty (`write(null)`), active null, jar updated with latest memories; delete active refused; transaction: a throwing `live.write` during insert leaves the previous active id and jar unchanged.

Commit: `feat(slimes): store + identity switching`.

### Task 3: Live identity wiring (quips, deep talk, drift, sprites)
**Files:** Create `studio/src/lib/mascot/identity.ts` (server: production `LiveIdentity` adapter + `activeIdentity()` returning `{ empty: boolean; voice; selfName; sliders; mods; drift; lengthShape }`); Modify `lib/mascot/prompt.ts` (persona block from identity: voice/selfName or EMPTY_BLOCK, + `sliderBlock`, sentence rule from `lengthShape`), `lib/mascot/quip.ts` / `quip-run.ts` (num_predict from lengthShape; new event kinds `slime_out` / `slime_in` with hints; drift on `idle` events and on dislike via `/api/taste` miyabi dislikes), `lib/persona.ts` (miyabi voice comes from the active slime when present), `app/api/chat/route.ts` (miyabi threads: persona block from `activeIdentity()`, num_predict from talkPredict), `lib/mascot/settings.ts` / `sprites.ts` (sprite dir = `data/mascot/<look.spriteDir>`; default ""), `lib/mascot/core.ts` (`MascotEvent.kind` adds `slime_out`, `slime_in`).
- Look: mascot settings' tag fields become the live look; the adapter reads/writes them with `look`.
- Memories: the adapter reads/writes MascotStore facts and the journal (replace on write; snapshot ≤ 50 rows).
- Empty: `activeIdentity().empty` → EMPTY_BLOCK, sliders ignored, drift no-op; quips still work (flat).

**Tests:** prompt with identity (voice + slider text + sentence rule present; data quoted); empty identity prompt has no Miyabi voice and no slider text; length band changes quip num_predict; drift applied on idle event within cap and never when empty; chat-model/route helper builds the miyabi persona from identity; sprite dir resolution + whitelist (no traversal via spriteDir).

Commit: `feat(slimes): live identity drives quips, deep talk, drift and sprites`.

### Task 4: Slime API (incl. mix + RP extract)
**Files:** Create `studio/src/app/api/mascot/slimes/route.ts` (GET list + active + live sliders; POST actions), `studio/src/lib/mascot/slime-ai.ts` (prompts + parsing for voice merge and RP distill, pure builders + injected `ask`), tests.
Actions (JSON `{ action, … }`): `extract {name,color}`, `remove`, `insert {id}`, `rename {id,name}`, `recolor {id,color}`, `delete {id}`, `sliders {id?, slider, value?, cap?}` (active jar when id omitted; also updates live), `heatDrift {on}`, `mix {a, b | "blank", ratio, name, color}`, `fromRp {characterId, name?, color}`.
- `remove`/`insert` also trigger one quip (`slime_out` in the outgoing voice before switching; `slime_in` in the new voice after) and return it so the UI shows it immediately; canned fallback.
- `mix`: sliders via `mixSliders`, look from the dominant (ratio ≥ 50 → a), memories via `mixMemories`, voice from APEX (`mergeVoicesPrompt(a.voice, b.voice, ratio)` quoting both as data; Blank voice = "" → output leans flat), `heavyGate.run`, think:false; empty/failed output → 502, nothing saved.
- `fromRp`: card via `RpStore` (description/personality/scenario/example dialogue quoted), APEX distils ≤ 1500 chars, look tags from `appearance_prompt` + `outfit_prompt` when present (else blank look), sliders 0/cap 10.

**Tests (pure):** merge/distill prompt builders quote inputs as data and cap them; parse/trim of model output; action validation (ratio bounds, unknown ids, delete-active refused) via the store with a fake live adapter.

Commit: `feat(slimes): API`.

### Task 5: Personality panel + sheet popover
**Files:** Create `studio/src/components/mascot/SlidersPanel.tsx` (5 rows: label, current value + cap handles (two range inputs or a value slider + small cap stepper), drift indicator when live > value, heat-drift toggle); Modify `MascotSettings.tsx` (Personality section using SlidersPanel), `MiyabiSheet.tsx` (header button → popover with SlidersPanel), Mascot.tsx (listen for `mascot:identity` event to refresh; dim/desaturate sprite when Empty).
- Saves on release (like the chattiness slider); failed saves revert and show an inline error.

**Tests:** extract pure helpers (e.g. slider row model / clamp on cap change) with tests.

Commit: `feat(slimes): sliders UI`.

### Task 6: The shelf
**Files:** Create `studio/src/components/mascot/SlimeShelf.tsx` (+ `Jar.tsx` SVG); Modify `MascotSettings.tsx` ("Unlock the slime shelf" toggle saved in mascot settings `shelf: boolean`; when on, a "Slime shelf" button opens the shelf Sheet).
- Shelf: grid of jars (SVG jar tinted by colour, name, glow on active, an empty dashed slot when Empty). Tap a jar → actions: Insert (or Remove if active), Rename, Recolour (palette + custom), Mix with…, Delete (alertdialog; disabled for active). Header actions: Extract current, From RP character (picker of RP characters), Mix (pick A, B or Blank, ratio slider 10–90, name, colour; shows "brewing…" while APEX runs).
- Removal/insertion: show the returned quip line in the shelf and fire the mascot bubble (dispatch a `mascot:say` event the floating Mascot shows).
- Phone usable: 44px targets, fits 390px.

**Tests:** pure helpers (palette, jar layout/sorting, mix form validation).

Commit: `feat(slimes): shelf`.

### Task 7: Verify, review, ship
- `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Controller live check on a scratch DB copy: first-run jar created, extract/remove (empty quip flat)/insert lines, one mix (APEX), one RP extract if an RP character exists in the copy (else create a test adult character in the copy).
- Final whole-branch review (Opus) with the Review focus; one fix wave; merge `slimes` → main (ff); `npm run deploy`.
