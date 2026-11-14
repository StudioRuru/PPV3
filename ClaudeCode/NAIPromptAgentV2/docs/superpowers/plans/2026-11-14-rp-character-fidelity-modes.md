# RP Character Fidelity, Profiles, Text/RP Modes & Thinking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** APEX keeps each card's character in its own voice and format, guided by an editable per-character profile. A 💬 Text / 🎭 RP pill replaces the old Style picker, Text mode replies in bursts of bubbles, and an optional hidden in-character planning step comes before each reply.

**Architecture:** A new `src/lib/rp/profile.ts` holds the profile type, parsing, extraction prompt, the per-turn prompt slice and the precedence rules. `prompt.ts` and `turn.ts` use it. A new `src/lib/rp/burst.ts` turns one Text-mode completion into bubbles, a reaction and photo requests. A new `src/lib/rp/think.ts` makes the planning call. Columns are added to the store with the existing `PRAGMA table_info` guard in `migrateRp`. The send route stays a single text/plain stream, and the client reloads the chat view after the stream ends, as it does today.

**Tech Stack:** Next.js App Router, TypeScript, better-sqlite3, Ollama via `src/lib/llm.ts`, NovelAI via `src/lib/novelai.ts`, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-14-rp-character-fidelity-modes-design.md`

## Global Constraints

- Default model stays `gemma4-26b-apex`. No new samplers (DRY/XTC), no RAG, no multi-card group chats, no Impersonate/Continue, no push notifications.
- The bench must not regress: a judge score under **8.7** or a lengthOk under **0.95** on the RP cases blocks shipping.
- `foldSystem` stays the last transform in `buildTurn`.
- Precedence, for every setting: per-chat Tune > hand-set character field > `profile.defaults` > global. Agency is replaced, not blended. Spice is clamped to `profile.defaults.spice {min,max}`. Conflicting mods are listed and never switched off.
- The profile never overrides the card, and an existing `appearancePrompt`/`outfitPrompt` beats the extracted `appearanceTags`.
- The card title is only a list label. Every prompt and header uses `displayName || name`.
- The thought is never shown in the reply. It can only be seen from the long-press menu.
- Tests: `npx tsx --test src/lib/rp/*.test.ts`. Typecheck: `npx tsc --noEmit -p .`. Never build in the live studio directory. Deploy only with `npm run deploy` (:3100).
- Commit with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit`. Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The model ignores `---` in Text mode** and sends one long paragraph, or 9 short lines. Expected: split on blank lines, then on sentences, giving at most 5 bubbles with the overflow merged into the last one. Test: `splitBurst fallback` in Task 9.
2. **The thought leaks into the reply.** The reply echoes "[Your private intent…" or starts with the plan's first line. Expected: stripped before saving. Test: `stripThoughtEcho` in Task 7.
3. **Legacy chats.** `style` "chat"/"story"/"" and messages with no burst fields must render, swipe and regenerate as before after the migration. Test: `migrate maps legacy styles` in Task 8, and `legacy message has no burst` in Task 9.
4. **Profile extraction fails.** The JSON may be invalid or partial, the vision model may error, or the avatar may be missing. Expected: the import still succeeds with `profile: null`, and the slice/steer code accepts any missing field. Test: `parseProfile tolerates junk` in Task 1, and `importCard succeeds when extraction throws` in Task 4.
5. **A double-text nudge lands while a send is in flight,** or after the user replied. Expected: refused on version mismatch, so there are no duplicate or out-of-order bubbles. It never fires twice in a row. Test: `nudge refused on stale version / after a nudge` in Task 12.

---

## Phase 1 — Fidelity + profile

### Task 1: Profile type, parsing, columns

**Files:**
- Create: `studio/src/lib/rp/profile.ts`, `studio/src/lib/rp/profile.test.ts`
- Modify: `studio/src/lib/rp/types.ts` (RpCharacter), `studio/src/lib/rp/schema.ts` (`migrateRp`), `studio/src/lib/rp/store.ts` (`saveCharacter` passes the new fields)

**Interfaces:**
- Produces:
  ```ts
  export type CastMember = { name: string; role: string; appearanceTags?: string };
  export type RpProfile = {
    displayName: string; cast: CastMember[]; coreTraits: string[];
    speech: { register: string; tics: string[]; sampleLines: string[] };
    format: string; wants: string[]; fears: string[]; knows: string[]; doesntKnow: string[];
    viewOfUser: string; wouldNever: string[]; hooks: string[]; relationships: string[];
    defaults: { agency?: number; spice?: { min: number; max: number }; mode?: "text" | "rp" };
    appearanceTags: string; conflicts: string[]; edited?: boolean;
  };
  export function parseProfile(raw: unknown): RpProfile | null; // fills every missing field with an empty value; null when nothing usable
  export const charName: (c: Pick<RpCharacter, "name" | "displayName">) => string; // displayName || name
  ```
  - `RpCharacter` gains `displayName: string` (column `display_name TEXT DEFAULT ''`) and `profile: string | null` (column `profile TEXT`, JSON).
  - The learned facts are kept per chat, not here (see Task 4).

- [ ] **Step 1: Write the failing tests.**
  - `parseProfile tolerates junk`: `parseProfile("nope") === null`, `parseProfile({}) === null`. `parseProfile({displayName:"Alice", coreTraits:"bubbly"})` returns `coreTraits: []` (a non-array is dropped), `cast: []`, `speech.tics: []`, `defaults: {}`.
  - A JSON string input is parsed.
  - `defaults.spice` with min > max is swapped.
  - `charName({name:"Alice in Wonderland | Lost Elf", displayName:"Alice"}) === "Alice"`. An empty displayName falls back to name.
  - Schema test: `display_name` and `profile` exist after `migrateRp`, and running it twice does not throw.
- [ ] **Step 2: Run** `npx tsx --test src/lib/rp/profile.test.ts src/lib/rp/schema.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - `parseProfile` and `charName` in `profile.ts`.
  - Add the two columns with the `PRAGMA table_info` guard in `migrateRp`.
  - Add both fields to the type and to `saveCharacter`.
  - Update the `char()` test factories in prompt/turn tests with `displayName: "", profile: null`.
- [ ] **Step 4: Run** all rp tests and tsc. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(studio): RP character profile type + display_name/profile columns`.

### Task 2: Precedence and the profile slice

**Files:**
- Modify: `studio/src/lib/rp/profile.ts`, `studio/src/lib/rp/profile.test.ts`

**Interfaces:**
- Consumes: `RpProfile`, `RpChat`, `RpCharacter`, `RpSettings`.
- Produces:
  ```ts
  export type Mode = "text" | "rp";
  export function resolveAgency(chat: RpChat, c: RpCharacter | null, p: RpProfile | null, s: RpSettings): number;
  export function resolveSpice(chat: RpChat, p: RpProfile | null, s: RpSettings): number; // value clamped to p.defaults.spice
  export function profileSlice(p: RpProfile, mode: Mode, turn: number): string; // ~150–250 tokens
  ```

- [ ] **Step 1: Write the failing tests.**
  - `resolveAgency order`:
    - chat 4 / char 1 / profile 2 / global 0 → 4.
    - With chat null → 1.
    - With chat and char null → 2.
    - With all three null → global.
  - `resolveSpice clamps`: chat 4 with `spice {min:0,max:2}` → 2. Chat null, global 1, `{min:2,max:3}` → 2.
  - `profileSlice always-on parts`: the output contains the cast names, `format`, every `wouldNever` item, `speech.register`, and at least one tic.
  - `profileSlice rotates`: `turn` 0 and 1 give different trait pairs when `coreTraits.length >= 4`. The same turn always gives the same output, with no randomness.
  - `profileSlice mode bias`:
    - Text includes at least one `sampleLines` item.
    - RP includes a `hooks` item and no sampleLines.
  - `profileSlice length`: under 1100 chars for a fully populated profile with 12 items per list.
- [ ] **Step 2: Run** `npx tsx --test src/lib/rp/profile.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions.
  - Rotation indexes are `turn`-based (`(turn * k) % len`), so a bench run can be reproduced.
  - Each list is capped: 2 traits, 1 want or fear, 1 hook, 1–2 tics, and 2 sample lines in Text mode only.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(studio): profile precedence + per-turn prompt slice`.

### Task 3: Wire the profile into prompt and steer; ensemble examples

**Files:**
- Modify: `studio/src/lib/rp/prompt.ts` (`assembleMessages`, `buildSystemPrompt`, `buildVoiceReminder`, `buildExampleMessages`), `studio/src/lib/rp/turn.ts` (`steerTurn`, `buildTurn`), `studio/src/lib/rp/exampleDialogue.ts`
- Test: `studio/src/lib/rp/prompt.test.ts`, `studio/src/lib/rp/turn.test.ts`

**Interfaces:**
- Consumes: `parseProfile`, `charName`, `resolveAgency`, `resolveSpice`, `profileSlice` (Task 2).
- Produces:
  - `Steer` gains `profile?: RpProfile | null`.
  - `steerTurn` takes directions from the profile (wants/fears/tics/hooks) with probability **0.7** when the profile has any of them, and from the generic `DIRECTIONS` pools otherwise.
  - `splitBySpeaker(example: string, cast: string[]): { speaker: string; text: string }[]` in `exampleDialogue.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `uses displayName`: a character with name "Alice in Wonderland | Lost Elf" and displayName "Alice" puts "You are Alice." in the system prompt. The long name does not appear.
  - `voice reminder falls back to profile`: with empty `personality` and coreTraits ["bubbly","airheaded"], the jb block contains "bubbly".
  - `slice injected post-history`: the profile's `wouldNever[0]` appears after the last history message, not in the system prompt.
  - `format restated`: with `profile.format = "X's Thoughts: **…**"`, the voice reminder contains it verbatim.
  - `agency/spice via precedence`: `moodDirective` gets the resolved agency, and the spice is clamped. Check the directive text for the clamped spice level.
  - `ensemble example split`: `splitBySpeaker("Rin: hi\nMio: yo\nRin: bye", ["Rin","Mio"])` → 3 entries with the right speakers. With an ensemble cast, `buildExampleMessages` labels the lines by speaker.
  - turn.test `steer uses profile`: with `rand` fixed at 0.1 and a profile with `hooks:["her missing sister"]`, a forced direction contains "her missing sister". With no profile, the output is unchanged (current tests still pass).
- [ ] **Step 2: Run** prompt/turn tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Swap `character.name` for `charName(character)` throughout `prompt.ts` and `turn.ts`.
  - Append `profileSlice(p, mode, turnIndex)` to the voiceReminder jb part. `mode` is `chat.style === "text" ? "text" : "rp"` (the legacy `"chat"` counts as text until Task 8). `turnIndex` is the count of assistant messages.
  - Use resolveAgency/resolveSpice in moodDirective and in `buildTurn`'s steer spice.
  - Add a `conflicts` line to the reminder only when the active mods intersect `profile.conflicts`: "Note: the {mod} mod conflicts with this character's card — stay true to the card where they clash."
- [ ] **Step 4: Run** all rp tests and tsc. Expected: PASS, and the foldSystem test is unchanged.
- [ ] **Step 5: Commit.** Message: `feat(studio): profile drives voice reminder, steer directions, precedence; ensemble examples`.

### Task 4: Profile extraction at import, rebuild, learned facts

**Files:**
- Modify: `studio/src/lib/rp/profile.ts` (extraction prompt + `extractProfile`), `studio/src/app/api/rp/import/route.ts`, `studio/src/app/api/rp/characters/[id]/route.ts` (add `POST …/profile` as `studio/src/app/api/rp/characters/[id]/profile/route.ts`), `studio/src/lib/rp/memory.ts` (`summarizeChat`), `studio/src/lib/rp/schema.ts` (`rp_chats.learned TEXT DEFAULT '[]'`), `studio/src/lib/rp/types.ts` (`RpChat.learned`)
- Test: `studio/src/lib/rp/profile.test.ts`, `studio/src/lib/rp/api.test.ts`

**Interfaces:**
- Consumes: `chatStream` (vision, the same pattern as `src/app/api/tag/characters/route.ts`), `toModelImage`.
- Produces:
  ```ts
  export const PROFILE_SYSTEM: string;
  export function profileRequest(c: RpCharacter, avatarB64?: string): { system: string; messages: ChatMessage[] };
  export async function extractProfile(c: RpCharacter, avatar: Buffer | null, ask: (system: string, messages: ChatMessage[]) => Promise<string>): Promise<RpProfile | null>;
  ```
  - `ask` is injected so tests don't call Ollama. Production uses `chatStream(..., { think: false, options: { temperature: 0.2 } })`, collected.
  - `POST /api/rp/characters/:id/profile` with body `{ force?: boolean }`. When the profile is `edited` and `force` isn't set, it returns 409 `{ error: "edited" }`. Otherwise it saves and returns the character.
  - `summarizeChat` also asks for up to **3** learned facts and appends them to `rp_chats.learned`, keeping at most 20 (oldest dropped). They go into the prompt next to the memory summary, never into `profile`.

- [ ] **Step 1: Write the failing tests.**
  - `extractProfile parses fenced JSON`: `ask` returns "```json {…}```", giving a parsed profile with `edited` unset.
  - `extractProfile returns null on junk`.
  - `importCard succeeds when extraction throws`: the import route test with a throwing `ask` → 200, with the character saved and `profile` null.
  - `rebuild refuses edited`: 409 without force, 200 with force.
  - `learned facts capped`: the summarize helper given 25 existing facts plus 3 new ones keeps 20, and the newest 3 are present.
  - `appearance precedence`: a character with `appearancePrompt` set keeps that prompt for photos. The extracted `appearanceTags` are only used when it is empty. Pin this as a pure helper `photoAppearance(c, p, speaker?)` here, which Task 11 consumes.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Extraction prompt rules: speak in the card's terms only and invent nothing. `cast` gets one entry per distinct speaker. `format` holds the literal output-format convention the card uses.
  - The import route runs extraction after saving the character, and also runs it detached. A failure only logs.
  - On any hand edit from the UI, mark the profile `edited: true`.
- [ ] **Step 4: Run** all rp tests and tsc. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(studio): APEX profile extraction at import + rebuild + learned chat facts`.

### Task 5: Character sheet — name and profile editing

**Files:**
- Modify: `studio/src/components/rp/CharacterSheet.tsx`, `studio/src/components/rp/RpChat.tsx` (the header `h1` at ~136 and `sub()` use `charName`)
- Create (if CharacterSheet would grow past ~400 lines): `studio/src/components/rp/ProfileEditor.tsx`

**Interfaces:**
- Consumes: `RpProfile`, `charName`, `POST /api/rp/characters/:id/profile`.
- Produces:
  - `<ProfileEditor value={RpProfile|null} onChange={(p: RpProfile) => void} onRebuild={() => void} />`.
  - Lists are edited as one item per line in textareas.
  - The `conflicts` list is shown read-only with a ⚠️.

- [ ] **Step 1:** Add a Display name field at the top of the sheet. Saving writes `displayName`. The list label still shows `name`.
- [ ] **Step 2:** Add a collapsed "Profile" section with the editor. Saving sets `edited: true`.
- [ ] **Step 3:** "Rebuild profile" button. On 409 it shows an inline confirm ("Overwrite your edits?") and resends with `force: true`. Don't use `window.confirm`.
- [ ] **Step 4:** Run tsc. Then verify against a scratch dev server (blank keys, as in memory `feedback_scratch_server_env`), not :3100.
  - Import the Alice card. The header shows "Alice". The profile is filled.
  - Edit a trait and rebuild: the confirm appears.
- [ ] **Step 5: Commit.** Message: `feat(studio): editable display name + character profile in the sheet`.

### Task 6: Checkpoint — re-bench and hand A/B

- [ ] **Step 1:** Run `npx tsx scripts/rp-bench.mts --model gemma4-26b-apex --label profile --runs 2 --judge --vs <latest apex baseline json>`.
  - Expected: RP-case judge ≥ 8.7 and lengthOk ≥ 0.95.
  - If it fails, stop and report the regression with numbers. Don't tune past the plan.
- [ ] **Step 2:** Hand A/B on the two named cards (Alice ensemble + one single-speaker card) with profile on vs. `profile=null`, 5 turns each. Record 3 lines of findings in the bench JSON's `notes` or in the commit body.
- [ ] **Step 3:** Commit the bench output, then deploy with `npm run deploy` only after the user approves.

## Phase 2 — Thinking

### Task 7: Hidden in-character planning step

**Files:**
- Create: `studio/src/lib/rp/think.ts`, `studio/src/lib/rp/think.test.ts`
- Modify: `studio/src/lib/rp/schema.ts` (`rp_messages.thought TEXT DEFAULT ''`, `rp_chats.think INTEGER` nullable), `studio/src/lib/rp/types.ts`, `studio/src/lib/rp/store.ts` (`append`/`addSwipe` accept `thought`), `studio/src/app/api/rp/chats/[id]/send/route.ts`, `studio/src/components/rp/RpChat.tsx` (long-press menu "💭 Thought"), `studio/src/components/rp/TuneSheet.tsx` (a toggle, only if the gate says toggle), `studio/scripts/rp-bench.mts` (`--think`)

**Interfaces:**
- Consumes: `Turn` from `buildTurn`, `chatStream`.
- Produces:
  ```ts
  export const THINK_TAG = "[Your private intent — act on it, don't repeat it]";
  export function thinkRequest(turn: Turn, charName: string): Turn; // same model, think:false, num_predict 200, temperature = base - 0.2 (floor 0.5)
  export function withThought(turn: Turn, thought: string): Turn; // inserts `${THINK_TAG}\n${thought}` as a system note before the final user turn, then re-runs foldSystem
  export function stripThoughtEcho(reply: string, thought: string): string;
  export function thinkOn(chat: RpChat, mode: Mode, settings: RpSettings): boolean;
  ```
  - The planning prompt asks for 3–5 first-person lines: what I notice, what I want right now, what I'll do, and what I won't say.

- [ ] **Step 1: Write the failing tests.**
  - `thinkRequest caps tokens`: num_predict is 200, temperature is lowered, and the model is unchanged.
  - `withThought placement`: the last user message contains THINK_TAG, and the first message is still the single system block (foldSystem invariant).
  - `stripThoughtEcho`:
    - Removes a leading THINK_TAG line.
    - Removes a reply-leading copy of the thought's first line.
    - Leaves unrelated text alone.
  - `thinkOn`: chat override > `settings.thinkByMode[mode]` > false.
- [ ] **Step 2: Run** `npx tsx --test src/lib/rp/think.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Send route: when `thinkOn`, collect the planning call first (status header `X-Thinking: 1` so the client keeps showing "Thinking…"). Then stream the reply from `withThought`, run `stripThoughtEcho` before saving, and save the `thought`.
  - `rp-bench --think` runs the same path.
- [ ] **Step 4: Run** all rp tests and tsc. Expected: PASS.
- [ ] **Step 5: Gate.** Run the bench with and without `--think` (`--runs 2 --judge`).
  - **Always-on:** judge ≥ baseline + 0.2 with no drop in lengthOk or memory. Set `thinkByMode.rp = true`.
  - **Otherwise:** expose the TuneSheet toggle, default off.
  - Put both numbers in the commit body.
- [ ] **Step 6: Commit.** Message: `feat(studio): hidden in-character planning step + bench gate`.

## Phase 3 — Modes

### Task 8: Text / RP pill; RP-mode cleanup; style migration

**Files:**
- Modify: `studio/src/lib/rp/schema.ts` (one-time `UPDATE rp_chats SET style = CASE style WHEN 'chat' THEN 'text' ELSE 'rp' END WHERE style NOT IN ('text','rp')`), `studio/src/lib/rp/presets.ts` (`CHAT_STYLES` → `MODES`, `STYLE_DIRECTIVE` keyed text/rp), `studio/src/lib/rp/prompt.ts` (~391: card POV locks win in RP mode), `studio/src/lib/rp/turn.ts` (`VOICE`/`openingsFor` keyed text/rp), `studio/src/lib/rp/store.ts` (`createChat` default mode from `profile.defaults.mode ?? "rp"`), `studio/src/components/rp/RpChat.tsx` (header pill), `studio/src/components/rp/TuneSheet.tsx` (remove the Style picker), `studio/src/lib/rp/bench.ts` and `scripts/rp-bench.mts` (style ids)
- Test: `migrate.test.ts`, `prompt.test.ts`, `turn.test.ts`, `store.test.ts`

**Interfaces:**
- Produces: `RpChat.style: "text" | "rp"`.
  - The pill PATCHes `{ op: "chat", style }`.
  - **RP directive:** the card's povMode/tense/dialogueStyle win when set. Otherwise third person, past tense, and "respond descriptively to {{user}}'s *actions*".
  - **Text directive:** the existing chat directive.

- [ ] **Step 1: Write the failing tests.**
  - `migrate maps legacy styles`: "chat"→"text", "story"→"rp", ""→"rp". Running it twice is idempotent.
  - `rp keeps card POV`: a card with `povMode:"second"` in RP mode → the second-person lock is present and the third-person default is absent.
  - `rp default POV`: an empty card → a third-person past-tense directive.
  - `createChat mode from profile`: a profile with `defaults.mode:"text"` → the new chat style is "text". With no profile → "rp".
  - The turn tests have VOICE keyed by text/rp.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The pill sits in the header right of the name: `💬 Text | 🎭 RP`, segmented, 44px tall hit area.
  - Remove the Style section and its `CHAT_STYLES` import from TuneSheet.
- [ ] **Step 4: Run** all rp tests and tsc. Then on a scratch server, flip the pill mid-chat and check the next reply follows it.
- [ ] **Step 5: Commit.** Message: `feat(studio): 💬 Text / 🎭 RP header pill replaces Style; card POV wins in RP`.

### Task 9: Text-mode bursts, typing, reactions, burst swipes, ensemble speakers

**Files:**
- Create: `studio/src/lib/rp/burst.ts`, `studio/src/lib/rp/burst.test.ts`
- Modify:
  - `studio/src/lib/rp/schema.ts` — `rp_messages`: `burst_id TEXT`, `burst_swipes TEXT` (JSON), `speaker TEXT DEFAULT ''`, `reaction TEXT DEFAULT ''`
  - `studio/src/lib/rp/types.ts`
  - `studio/src/lib/rp/store.ts`
  - `studio/src/app/api/rp/chats/[id]/send/route.ts`
  - `studio/src/app/api/rp/chats/[id]/route.ts` (PATCH `op: "burstSwipe"`)
  - `studio/src/lib/rp/presets.ts` — Text directive: "Send 1–5 short texts separated by a line containing only `---`. To react to their last message with an emoji, start with `[react:😭]`." For ensembles: "Prefix each text with `Name:`."
  - `studio/src/lib/rp/turn.ts` — `openingKind` and `recent` use the burst's joined text
  - `studio/src/components/rp/RpChat.tsx`
- Test: `burst.test.ts`, `store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Bubble = { text: string; speaker: string; photo?: string };
  export type Burst = { bubbles: Bubble[]; reaction: string };
  export function splitBurst(raw: string, cast: string[]): Burst; // max 5 bubbles
  export const typingMs: (text: string) => number; // clamp(40 * text.length, 600, 3000)
  // RpStore:
  appendBurst(chatId: number, burst: Burst, replyTo: number | null, expect: number, thought?: string): number[] | null; // sets reaction on replyTo; new burstId; head holds burst_swipes=[burst]
  replaceBurst(burstId: string, burst: Burst, expect: number): boolean; // pushes to the head's burst_swipes, rewrites the bubble rows to the new set
  pickBurst(burstId: string, index: number, expect: number): boolean;
  ```
  - `RpMessage` gains `burstId: string | null`, `burstSwipes: Burst[] | null` (head only), `speaker`, `reaction`.
  - Regenerate in Text mode is allowed only for the last burst. The send body uses `regenerate: <any msg id in the last burst>`.

- [ ] **Step 1: Write the failing tests.**
  - `splitBurst separators`: "a\n---\nb\n---\nc" → 3 bubbles.
  - `splitBurst fallback`:
    - No `---` with blank-line paragraphs → split by paragraph.
    - One paragraph of 4 sentences → 4 bubbles.
    - 9 lines → 5 bubbles, the last holding lines 5–9 joined.
  - `splitBurst reaction`: "[react:😭]\nomg" → reaction "😭", one bubble "omg". Unknown or long tokens are not treated as reactions.
  - `splitBurst ensemble`: cast ["Rin","Mio"] and "Rin: hi\n---\nMio: yo" → speakers set and the prefixes stripped. A name not in the cast stays in the text with speaker "".
  - `typingMs clamps`: "" → 600, a 200-char text → 3000.
  - store `appendBurst/replaceBurst/pickBurst`:
    - After a replace, the head's `burstSwipes.length` is 2 and the rows hold the new bubbles.
    - `pickBurst(…, 0)` restores the original bubbles and the bubble count, adding or deleting rows as needed.
    - A stale `expect` → null/false.
  - `legacy message has no burst`: `messages()` on pre-migration rows → `burstId` null, and `pickSwipe` still works.
- [ ] **Step 2: Run** `npx tsx --test src/lib/rp/burst.test.ts src/lib/rp/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the server side.**
  - In Text mode the send route streams the raw text as today, then saves with `splitBurst` → `appendBurst` (or `replaceBurst` when regenerating).
  - Rewind to a mid-burst bubble deletes everything after it, so the burst's swipes are dropped. That's the existing rewind behaviour; no new code.
- [ ] **Step 4: Implement the client side** in RpChat.
  - While streaming in Text mode, show the "•••" typing bubble and "typing…" under the name. Don't stream raw text.
  - After reload, reveal the new burst's bubbles one at a time with `typingMs` delays. The burst is "new" when its head id is greater than the last id seen before send.
  - Show the reaction under the user bubble.
  - Speaker name and colour dot on ensemble bubbles.
  - ‹ n/m › on the last bubble of the last burst calls PATCH `burstSwipe`.
- [ ] **Step 5: Run** all rp tests and tsc. Then on a scratch server:
  - Text mode on Alice: a burst of 2–5 appears with typing.
  - Retry, then ‹ restores the earlier set.
- [ ] **Step 6: Commit.** Message: `feat(studio): Text mode bursts — typing, reactions, burst swipes, ensemble speakers`.

### Task 10: Re-run the thinking gate with Text mode

**Files:**
- Modify: `studio/scripts/rp-bench.mts` (tsundere-text case → style "text"), `studio/src/lib/rp/bench.ts` (`scoreReply` for style "text" counts `splitBurst(...).bubbles.length` against `TEXTS_FOR_LEVEL`)
- Test: `bench.test.ts`

- [ ] **Step 1: Failing test.** `scoreReply text style uses bursts`: "a\n---\nb\n---\nc" at a level whose TEXTS range is [2,3] → `lengthOk` true.
- [ ] **Step 2: Implement.** Run the test. Expected: PASS.
- [ ] **Step 3:** Rebaseline the Text case (`--label text-base`), then run `--think`. Apply the Task 7 gate per mode and set `thinkByMode.text` accordingly. The anti-goal bars still apply to the RP cases only.
- [ ] **Step 4: Commit** with the numbers in the body.

## Phase 4 — Photos + double-text

### Task 11: Photo messages in Text mode

**Files:**
- Create: `studio/src/lib/rp/photo.ts`, `studio/src/lib/rp/photo.test.ts`
- Modify:
  - `studio/src/lib/rp/burst.ts` — parse `[photo: desc]` into `Bubble.photo`
  - `studio/src/lib/rp/schema.ts` — `rp_messages.image_id INTEGER`
  - `studio/src/lib/rp/presets.ts` — Text directive line: "You may send a photo as `[photo: what it shows]` — rarely, or when asked."
  - `studio/src/lib/rp/turn.ts` — only offer the photo line when the last photo was ≥ 8 assistant turns ago, or the user's message asks for a photo/pic/selfie
  - `studio/src/app/api/rp/chats/[id]/send/route.ts` — after saving, render detached
  - `studio/src/components/rp/RpChat.tsx`
- Test: `photo.test.ts`, `burst.test.ts`

**Interfaces:**
- Consumes: `photoAppearance(c, p, speaker?)` (Task 4), `generateImage`, `saveRpFile`, the `rp_images` table.
- Produces:
  ```ts
  export function photoPrompt(c: RpCharacter, p: RpProfile | null, speaker: string, desc: string, spice: number): string; // appearance, then outfit, then desc tags; spice < 3 adds the "nsfw" negative / safe-rating tags
  export function photoDue(history: RpMessage[], lastUser: string): boolean;
  export async function renderPhoto(store: RpStore, msgId: number, prompt: string, token: string): Promise<number | null>; // rp_images id
  ```
- [ ] **Step 1: Write the failing tests.**
  - `photoPrompt order + speaker`: the ensemble speaker "Mio" uses Mio's `appearanceTags`. The card's `appearancePrompt` beats the extracted tags.
  - `photoPrompt spice gate`: spice 1 has no explicit tags in the desc pass-through and includes the safe-rating tag.
  - `photoDue`: true at ≥ 8 turns since the last `image_id`, true when the user says "send a pic", false otherwise.
  - `splitBurst photo`: "[photo: me pouting by a tree]" → `bubble.photo` set and text "".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The client shows a placeholder bubble ("📷 sending…") until `image_id` is set (re-fetch every 3 s while any is pending, stopping after 90 s).
  - Tap opens full-screen.
  - A NAI failure turns the placeholder into "📷 photo failed", with no retry loop.
- [ ] **Step 4: Run** tests and tsc. Then on a scratch server, with a real NAI token only after the user okays the spend, ask Alice for a selfie.
- [ ] **Step 5: Commit.** Message: `feat(studio): Text mode photo messages via NAI`.

### Task 12: Double-text nudge

**Files:**
- Create: `studio/src/app/api/rp/chats/[id]/nudge/route.ts`
- Modify:
  - `studio/src/lib/rp/schema.ts` — `rp_chats.double_text INTEGER DEFAULT 1`
  - `studio/src/lib/rp/turn.ts` — `buildTurn(..., { nudge: true })` adds the note "{{user}} hasn't replied for a few minutes — send a short follow-up text."
  - `studio/src/components/rp/RpChat.tsx` — timer + ⋯ menu toggle
- Test: `studio/src/lib/rp/api.test.ts`

**Interfaces:**
- `POST /api/rp/chats/:id/nudge` with body `{ version }`.
- It is refused with 409 when:
  - the version is stale,
  - the last message isn't an assistant message,
  - the last burst was itself a nudge (tracked as `rp_messages.nudge INTEGER DEFAULT 0` on the head),
  - `double_text` is 0, or
  - the style isn't "text".
- On success it saves a burst the same way as send.
- Client: after a reply, while the tab is visible, arm `setTimeout(rand 120–360 s)`. Cancel it on input, send or unmount.

- [ ] **Step 1: Write the failing tests.** `nudge refused on stale version / after a nudge / when disabled / in rp mode`; `nudge appends one burst marked nudge`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run the tests and tsc. Expected: PASS.
- [ ] **Step 4: Commit.** Message: `feat(studio): Text mode double-text nudge`.

## Phase 5 — Optional

### Task 13: HER-32B evaluation (only if the user asks)

- [ ] Pull a GGUF of `ChengyuDu0123/HER-32B` that fits 24 GB (Q4_K_M or smaller), run `rp-bench --model her-32b --runs 2 --judge --vs <apex profile json>`, and report the table. No code change unless it beats APEX on the RP cases.

---

## Self-review notes

- **Spec coverage:**
  - §1 → T1–T3
  - §2 → T1, T2, T4, T5
  - §3 → T8, T9, T11, T12
  - §4 → T7, T10
  - Order and HER → T6, T13
  - The left-to-builder distinctness check is folded into T6 step 2 (hand A/B).
- **Builder calls made here:**
  - Profile directions are used with probability 0.7.
  - At most 20 learned facts per chat.
  - Photo cadence is counted in assistant turns.
  - The nudge window is 120–360 s.
  - Text mode streams a typing indicator, not raw text.
