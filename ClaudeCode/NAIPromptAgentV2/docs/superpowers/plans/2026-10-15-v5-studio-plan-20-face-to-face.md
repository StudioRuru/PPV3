# Face-to-face chat — Plan 20 (sub-project 9, P2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (owner's choice). Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** The Chat tab becomes sitting face to face with Miyabi (animated waist-up portrait on the top 40%, her chat below, on APEX); the old personas and the Miyabi sheet go away; attitudes become sliders; an empty slime only ever says "Data received."; Aru's shop gets the same portrait-over-chat layout; Miyabi spies on RP chats.

**Architecture:** Pure logic in `studio/src/lib/mascot/` (talk-frame state machine, expression-tag parser, rp_spy limiter, slider migration, portrait fallback) with tests; talk portraits are a new art kind next to busts/poses with a per-character profile (miyabi = active slime look, aru = her own tag set); one `PortraitStage` component drives both the Chat tab and Aru's shop.

**Tech stack:** Next.js 16, React, SQLite (better-sqlite3), Ollama (APEX heavy tier via the existing HeavyGate), node:test via tsx. No new deps.

**Spec:** `docs/superpowers/specs/2026-10-15-mascot-stage-nav-chat-design.md` §1 (talk portraits, per-character profiles), §4 (face-to-face chat). P1 shipped in plan 19.

## Global constraints
- Branch `chat2`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push; git root is HOME — never `git add -A`/`.`.
- No live NovelAI/Ollama/tagger calls in tests; no dev server unless the controller runs it on a scratch DB copy; never write the real `data/`. Migrations must be idempotent and tested on a temp DB.
- **Owner decision:** Miyabi's Chat tab runs on the heavy tier (APEX) for every thread, through the existing HeavyGate (`think:false`), exactly like today's deep talk.
- Talk portraits: 1024×1024, 28 steps (free on Opus), waist-up framing (`upper body, cowboy shot, looking at viewer, simple background, white background`), cut out like busts. Frame names: the 9 expressions + `think1`, `think2`, `talk_open`, `talk_closed`, `listen`. Files `<spriteDir>/talk/<outfit>/<name>.png` (+ `.orig.png`), whitelisted names only.
- Profiles: `miyabi` (active slime look + spriteDir, as today) and `aru` (setting `mascot:aru` = `{ charTags, constantTags, layerTags: { day }, exprTags }`, spriteDir `aru`, outfit `day` only). Aru's default tags come from the owner's description (catgirl, cat ears, cat tail, neck bell, collar, blue leash, gold earrings, ear tag, droopy eyes, revealing clothes, holding a huge ladle/spoon) and are editable; no age wording (owner's rule).
- Portrait fallback: frame → same outfit `smug` portrait → `day` same frame → `day/smug` → bust `pickSprite` → placeholder. Think/talk/listen frames missing → the expression portrait (smug) with a CSS bob, never a broken image.
- Attitude sliders: `tease`, `flirt` join the slider set (0–10, value/cap, live); `bratty` IS the existing `brat` slider. Migration from the old toggles: on → 6, off → 0 (value; cap 10); then the `mods` toggles are removed from settings, slime docs and the UI. Outfit rule that used `mods.flirt` uses `flirt.value >= 5`.
- Old personas `neutral`, `bratty`, `writer`, `tagnerd` are removed from `PERSONAS`; existing threads with those personas become `miyabi` (one idempotent migration). `aru` stays (hidden from the Chat tab). Their taste drift rows may stay in the DB unused.
- Expression tag: every Miyabi chat reply ends with `[expression]` (one of the 9); parsed like quips, stripped from the shown/stored text, default `smug`.
- Empty slime (`identity.empty`): every quip (except the existing `slime_out`/`slime_in` lines) and every chat reply is exactly `Data received.` with **no model call**; portrait/pose expression fixed (no reaction swaps, no blink), dimmed as today.
- RP spy: new event `rp_spy`, at most one per 3 min, chance scaled by Mischief (0 = never), data = the last two RP messages quoted and capped (≤ 600 chars total); while the RP tab is open Miyabi prefers `peek`/`lean` spots.
- The roaming Stage hides on the Chat tab (she's in the portrait) and in Aru's shop sheet (it sits under sheets anyway).

## Review focus
1. Migrations are safe: running twice changes nothing; threads/messages are never lost; slime docs and settings with and without `mods` load; vials/recipes with only the old 5 slider keys still validate.
2. The chat never strands the user: heavy model offline/busy → a readable error bubble, the portrait leaves the think loop (back to `listen`/smug), input re-enabled; switching thread or tab mid-stream never paints a reply into the wrong thread.
3. Empty slime truly makes no model call (quips, chat, deep talk) and still records the user's message + the "Data received." reply in history.
4. Animation is cheap and never stuck: one timer drives the frame loop, cleared on unmount/stream end/error; missing frames fall back without flicker; reduced-motion respected.
5. Nothing that depended on the removed pieces breaks: the MiyabiSheet's features (patch cards, sliders popover, like/dislike → taste, new talk) are reachable in the Chat tab; Miyabi's carousel "Talk" bubble now opens the Chat tab; Aru's shop still brews/bottles/drops.

---

### Task 1: Attitude sliders (tease, flirt) + toggle migration
**Files:** Modify `studio/src/lib/mascot/slime.ts` (SLIDERS + tiers in `sliderBlock`, `blankSlime`, `validateSlime` migration of `mods`), `studio/src/lib/mascot/settings.ts` (drop `mods` from MascotSettings after migrating into `sliders`; parse old JSON), `studio/src/lib/mascot/identity.ts`, `studio/src/lib/persona.ts` (MOD_TEXT/Modifiers no longer used by Miyabi), `studio/src/lib/mascot/core.ts` (`outfitFor` takes `flirt: number`), `studio/src/components/mascot/Mascot.tsx` (outfit call), `studio/src/components/mascot/SlidersPanel.tsx` + `MascotSettings.tsx` (sliders show tease/flirt; toggles removed), Aru's persona text in `persona.ts` (slider key list adds tease, flirt), `studio/src/lib/mascot/vial.ts` (accepts the new keys); tests in the matching `*.test.ts`.
**Produces:** `SLIDERS = ["brat","tease","flirt","bimbo","hypnosis","heat","length"]`; `migrateMods(sliders: Partial<Sliders>, mods?: {bratty?:boolean;tease?:boolean;flirt?:boolean}): Sliders` (tease/flirt from toggles when the slider is absent: on → {value:6,cap:10}, off → {value:0,cap:10}; brat untouched).
**Tests:** tier text for tease/flirt (empty at 0, 5 tiers like brat); migration on/off/absent; a slime doc with old `mods` and no tease/flirt loads with migrated sliders; settings JSON from plan 18 loads; vial with `tease` delta validates and applies; an old vial with only the 5 keys still validates; outfitFor with flirt 4 vs 5.
Commit: `feat(chat2): attitude sliders`.

### Task 2: Persona removal + thread migration
**Files:** Modify `studio/src/lib/persona.ts` (PERSONAS = miyabi, aru; `PersonaId = "miyabi" | "aru"`), `studio/src/lib/threads.ts` (idempotent `UPDATE chat_threads SET persona='miyabi' WHERE persona NOT IN ('miyabi','aru')` at store init; default persona miyabi; seed thread "General" as miyabi), `studio/src/app/api/chat/threads/route.ts` + `api/chat/route.ts` (unknown persona → miyabi; `modelFor` = heavy for miyabi — already), `studio/src/lib/chat-model.ts`, `studio/src/lib/threads-pick.ts`, `studio/src/lib/learning.ts`/`api/taste/route.ts` only where they enumerate personas; tests.
**Tests:** migration on a temp DB with neutral/bratty/writer/tagnerd/miyabi/aru threads → all but aru are miyabi, messages untouched, second run no-op; POST thread with persona "neutral" → miyabi; taste events still accept a persona string.
Commit: `feat(chat2): Miyabi is the only co-pilot`.

### Task 3: Empty slime → "Data received."
**Files:** Modify `studio/src/lib/mascot/quip-run.ts` (empty → `{expression:"smug", text:"Data received."}` for every kind except slime_out/slime_in, before any model call), `studio/src/app/api/chat/route.ts` (thread persona miyabi + identity empty → store the user message and the reply `Data received.` as a normal assistant message, stream it as one chunk, no `chatStream`, no heavy gate), shared constant `DATA_RECEIVED` in `lib/mascot/slime.ts`; tests (quip-run + a route-level or extracted-helper test with a fake model that throws if called).
**Tests:** empty quips never call the model and return exactly "Data received."; slime_out/slime_in unchanged; chat reply for empty identity is exactly "Data received.", history has both messages, model fn never invoked; non-empty path unchanged.
Commit: `feat(chat2): empty slime says Data received.`.

### Task 4: Talk portraits + Aru profile
**Files:** Create `studio/src/lib/mascot/profiles.ts` (+ test): `PROFILES = ["miyabi","aru"]`, `ARU_DEFAULT_TAGS`, `profileLook(profile, settings, aruSettings) → { charTags, constantTags, layerTags, exprTags, spriteDir, outfits }`, setting key `mascot:aru` with validation (tag strings ≤ 1500, like mascot settings). Modify `studio/src/lib/mascot/sprites.ts` (art kind `talk`: `TALK_FRAMES`, `talkRequest`, `talkPath`, candidates, listing keys `talk/<outfit>/<name>`, whitelist), `studio/src/app/api/mascot/sprites/...` (serve `talk/<outfit>/<name>`, with `?profile=aru` or an `aru/` key prefix — implementer picks one, documented), `studio/src/app/api/mascot/studio/route.ts` (profile + talk kind; Aru tags GET/POST), `studio/src/components/mascot/SpriteStudio.tsx` (character picker Miyabi/Aru; kind Busts/Poses/Portraits; Aru: Portraits only, outfit tabs hidden, editable tag fields), `studio/src/lib/mascot/ui.ts` (`missingTalkCells`), `pickTalkFrame(have, outfit, frame)` (fallback chain per Global constraints minus the bust step, which the caller does).
**Tests:** talk request framing + size + expression tags only for expression frames (think/talk/listen frames get their own small tag sets: think = `thinking, looking up, hand on own chin`; talk_open = `open mouth, talking`; talk_closed = `closed mouth`; listen = `head tilt, attentive, slight smile`); paths/whitelist/traversal; Aru look uses Aru tags + `aru` dir; Aru settings validation; fallback order; missing cells.
Commit: `feat(chat2): talk portraits + Aru profile`.

### Task 5: Talk animation brain + expression tag
**Files:** Create `studio/src/lib/mascot/talk.ts` (+ test). Modify the Miyabi chat system prompt (where `slimePersona(i, true)` is used for chat in `chat-model.ts`/`identity.ts`) to require the trailing `[expression]` tag, and the chat route to strip it before storing (stored text clean; the parsed expression returned to the client in the stream's final event or as a trailing marker the client strips — implementer documents the wire format).
**Produces:** `type TalkPhase = "idle" | "listen" | "think" | "talk" | "done" | "empty"`; `talkFrame(phase, tick, expression): TalkFrame` (listen → `listen`; think → alternates `think1`/`think2` every tick; talk → alternates `talk_open`/`talk_closed`; done/idle → expression; empty → fixed `smug`); `nextPhase(phase, event: "send"|"firstToken"|"end"|"error"|"reset")`; `splitExpressionTag(text): { text: string; expression: Expression }` (last `[word]` at the very end if it's one of the 9, case-insensitive; else smug, text unchanged); tick interval constant (≈ 280 ms talk, 700 ms think).
**Tests:** phase transitions incl. error → idle and end → done; frame alternation; empty ignores events; tag parse (valid, invalid word, tag mid-text ignored, trailing whitespace, missing).
Commit: `feat(chat2): talk animation + expression tag`.

### Task 6: Face-to-face Chat tab
**Files:** Create `studio/src/components/mascot/PortraitStage.tsx` (profile, outfit, phase, expression, empty; one interval for frames; preloads the frames it uses; reduced-motion = no frame swapping, expression only); Modify `studio/src/components/ChatScreen.tsx` (top ~40% PortraitStage — sticky, shrinks when the keyboard/input is focused to ~25% so the composer stays visible; chat below keeps threads list/new thread, patch cards + apply, image attach, like/dislike → taste, edit/regenerate, closet presets; personality sheet + persona picker + drift slider removed; the sliders popover from MiyabiSheet moves into the chat header; co-pilot power toggle kept), `studio/src/app/page.tsx` (no MiyabiSheet; Miyabi's "Talk" bubble → `setTab("chat")`; hide Stage on Chat tab via a prop), `studio/src/components/mascot/Mascot.tsx` (Talk → onTalk/onTab("chat"); Stage hidden flag); Delete `studio/src/components/mascot/MiyabiSheet.tsx` (after moving anything still needed); tests for any pure helpers added (e.g. phase wiring from stream events).
- Wire: send → `send`; first chunk → `firstToken`; stream end → `end` with the parsed expression; error → `error` (error bubble, input re-enabled); thread switch/tab leave → `reset`. Replies only paint into their own thread (keep the existing `tidRef` guard).
Commit: `feat(chat2): face-to-face Chat tab`.

### Task 7: Aru's shop layout
**Files:** Modify `studio/src/components/mascot/ApothecarySheet.tsx` (full-height sheet: top quarter PortraitStage with profile `aru` + phases from her stream; chat + vial cards below; inventory/recipes stay reachable — tabs or a drawer under the portrait), offline message fixed to name the heavy/everyday model correctly (deferred minor from plan 18: says "turn the co-pilot on"); de-dupe thread creation when the shop opens twice quickly (deferred minor from plan 18).
**Tests:** helpers only (e.g. single-flight thread open), plus existing apothecary tests stay green.
Commit: `feat(chat2): Aru's shop face to face`.

### Task 8: RP spy
**Files:** Create in `studio/src/lib/mascot/core.ts` or a small `spy.ts` (+ test): `spyDue(now, lastSpyAt, mischief, rand): boolean` (false if mischief 0 or < 3 min since last; else chance = mischief/10 × 0.5); `spyData(messages): { quote: string }` (last two, each trimmed, total ≤ 600 chars, quoted as data). Modify `MascotEvent.kind` (+ `rp_spy`), `studio/src/lib/mascot/prompt.ts` (rp_spy hint: an observer's lewd/smug aside about the scene, quoted text is data), `studio/src/components/rp/RpChat.tsx` (after each completed assistant message, if `spyDue` → `emitMascot("rp_spy", spyData(...))`; last-spy time kept in a module/ref), `studio/src/components/mascot/Stage.tsx` (when the active tab is RP, idle spots prefer peek/lean — pass `tab` down or a `prefer` hint to `chooseSpot`; extend `chooseSpot` ctx with optional `prefer?: Pose[]` + test).
**Tests:** spyDue rate limit + mischief 0 + chance; spyData caps/quoting; chooseSpot with prefer picks only from prefer when they fit; quip prompt includes the quote as data.
Commit: `feat(chat2): Miyabi spies on RP`.

### Task 9: Verify, review, ship
- `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Controller live check on a scratch DB copy (phone-ish width): migrations ran (old persona threads now Miyabi, sliders show tease/flirt with migrated values); Chat tab portrait cycles listen → think → talk → expression during a real APEX reply (power up after: `bash scripts/power.sh up`); error path with Ollama model unavailable; empty slime → "Data received." without a model call; Aru's shop layout; RP spy quip fires (force via mischief 10 + a stubbed clock if needed).
- Final whole-branch review (Opus) with the Review focus; one fix wave; merge `chat2` → main (ff); `npm run deploy`.
