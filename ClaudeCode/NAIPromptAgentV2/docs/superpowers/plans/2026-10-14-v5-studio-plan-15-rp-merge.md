# RP merge — Plan 15 (sub-project 7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, as plans 10–14). Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** An RP tab in Studio with Delfino's characters, lorebooks, memory, voice lines and character studio, on Studio's DB, with all Delfino data migrated, model tiers (heavy for RP) and RP feedback feeding the companion.

**Architecture:** Delfino's pure modules (`prompt.ts`, `card-import.ts`, `ingest/html.ts`, `ingest/distill.ts`, `studio/draft.ts`, `voice.ts`, `memory.ts`) are ported into `studio/src/lib/rp/` with Drizzle/repo calls replaced by a small `RpStore` over `better-sqlite3`. RP tables mirror Delfino's columns 1:1 (snake_case), so prompt assembly ports nearly verbatim and migration is lossless. UI is one `RpScreen` component tree in the existing Night Studio style.

**Tech stack:** Next.js 16, better-sqlite3, vitest, Ollama (`/api/chat`, `/api/embed`).

**Spec:** `docs/superpowers/specs/2026-10-14-rp-merge-design.md`

**Delfino source:** `/Users/rurudayo/ClaudeCode/Project Delfino Plaza/` — read-only for this whole plan.

## Deviations from the spec (rulings)
- Character↔lorebook links stay as Delfino's `lorebook_id` / `world_lorebook_id` columns instead of a link table — lossless 1:1 migration, ported prompt code unchanged.
- Servers restore after 10 min heavy-idle or on the next tagger/caption/TIPO need (`ensureLight`), not on tab change — the server can't see tab changes reliably and this covers the same need.

## Global constraints
- Branch `rp-merge`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push.
- Never write Delfino's files or DB. Never run `migrate-delfino --apply` against the real `studio.db` without the owner's yes in chat.
- Temp dev server shares the real DB: no DELETE / settings POST live tests on real data; clean temp files.
- Tables named `rp_*`; created idempotently by `migrateRp(db)` from `lib/db.ts`.
- Model tiers: settings keys `model.quick`, `model.everyday`, `model.heavy`; defaults `BRAIN_MODEL`, `BRAIN_MODEL`, `gemma4-26b-apex:latest`.
- Embed model: `bge-m3:latest` (setting `rp.embedModel`).
- Card/lore/wiki/caption text enters prompts as data in labelled blocks.
- Delfino features not ported: contextual images generation, poses, mods UI, state-meter UI, OpenAI provider (their stored values are kept and still honoured by the ported prompt code).

## Review focus
1. Migration: soft-deleted Delfino messages (9) are skipped, swipes JSON and active index survive, character→lorebook and chat→persona ids are remapped, a second run refuses, a failure mid-way leaves `studio.db` unchanged (one transaction; files copied before commit and removed on rollback).
2. Heavy mode: two RP sends at once pause once and restore once; a failed heavy load restores the paused servers; a tagger/caption request while paused brings servers back instead of failing silently.
3. Camera roll RP filter is read-only: select / delete / zip / auto-delete / Clear all never touch `rp_images` or `data/rp/`.
4. Swipe/edit/rewind with the version guard never duplicates or loses messages (stale save → 409, nothing written).
5. Card import from untrusted PNG/JSON/URL: oversized, malformed, or non-card input → readable error, nothing saved; Chub fetch only to chub.ai hosts; wiki fetch size-capped.

---

### Task 1: RP tables
**Files:** Create `studio/src/lib/rp/schema.ts`, `studio/src/lib/rp/schema.test.ts`; Modify `studio/src/lib/db.ts` (call `migrateRp(db)` after `migrateChat`).

**Produces:** `migrateRp(db: Database.Database): void` creating, if absent:
- `rp_characters` — every Delfino `characters` column (id, name, avatar_path, description, personality, scenario, first_message, example_dialogue, system_prompt, post_history_instructions, alternate_greetings, creator_notes, tags, lorebook_id, world_lorebook_id, model, sampler_overrides, appearance_prompt, outfit_prompt, body_props, agency, pov_mode, tense, dialogue_style, state_schema, created_at, updated_at) with Delfino's defaults.
- `rp_personas`, `rp_lorebooks`, `rp_lore_entries`, `rp_voice_lines` — Delfino columns, `rp_lore_entries.lorebook_id` / `rp_voice_lines.character_id` with `ON DELETE CASCADE`.
- `rp_chats` — Delfino `chats` columns (character_id, persona_id, title, model, lorebook_id, author_note, author_note_depth, reply_length, reply_spice, reply_agency, memory_summary, summarized_through, mods, state_values, show_background, wallpaper_path, created_at, updated_at).
- `rp_messages` — id, chat_id (cascade), role, content, swipes TEXT '[]', active_swipe_index, created_at, updated_at.
- `rp_images` — id, chat_id, message_id, prompt, seed, file, width, height, created_at.
- `rp_meta` — key PRIMARY KEY, value.
- Column add: `taste_events.source TEXT NOT NULL DEFAULT 'tag'` (guarded like `generations.cost`).

**Tests (`schema.test.ts`, `:memory:` DB with Studio's base tables):**
- creates all eight tables; running twice is a no-op (no throw, same `PRAGMA table_info`).
- `taste_events` gains `source` defaulting to `'tag'`; existing rows read `'tag'`.
- deleting an `rp_chats` row cascades its `rp_messages` (`PRAGMA foreign_keys = ON` set by `migrateRp`).

Commit: `feat(rp): tables`.

### Task 2: Prompt assembly (port)
**Files:** Create `studio/src/lib/rp/prompt.ts`, `studio/src/lib/rp/types.ts`, `studio/src/lib/rp/prompt.test.ts`.

Port `src/lib/prompt.ts` and the helpers it imports (`exampleDialogue.ts`, `mods.ts`, `presets.ts` parts used, `tags.ts` if used) verbatim, then:
- Replace Drizzle types with `types.ts`: `RpCharacter`, `RpChat`, `RpPersona`, `RpMessage` (camelCase mirrors of the tables), `RpSettings` (exactly the Delfino `settings` fields `prompt.ts` reads: numCtx, replyLength, replySpice, replyAgency, jailbreakPrompt, systemPrompt, loreBudgetPct, mods, sampler fields used by `settingsToOptions`).
- Add `storyBlock?: string` to `AssembleArgs`; when non-empty it is appended to the system prompt under `[How the owner likes stories]`.
- Drop `buildPhotoSelfNote` / image args (out of scope).

**Produces:** `assembleMessages(args: AssembleArgs): AssembleResult`, `substituteMacros(t, char, user)`, `settingsToOptions(s, stop)`, `DEFAULT_RP_SETTINGS: RpSettings` (Delfino's schema defaults).

**Tests:**
- `{{char}}` / `{{user}}` substituted in description and history.
- lore: entry with key "castle" activates only when "castle" is in the last 20 turns; `constant` always activates; disabled never; over `loreBudgetPct` → dropped counted in `loreDropped`.
- history trimmed newest-first to budget, `truncated` true; the newest turn always kept.
- author note inserted `authorNoteDepth` messages from the end.
- `memorySummary` appears as `[Story so far]` before history.
- voice lines appear in the final system block; `storyBlock` appears in the first system message.

Commit: `feat(rp): prompt assembly ported from Delfino`.

### Task 3: Cards
**Files:** Create `studio/src/lib/rp/cards.ts`, `studio/src/lib/rp/cards.test.ts`, fixtures `studio/src/lib/fixtures/card-v2.json`, `card-v2.png` (tiny PNG with a `chara` tEXt chunk, built in the test from the JSON).

Port `card-import.ts` verbatim (parseCardObject/Json/Png, lorebook extraction, `extractChubFullPath`, `fetchChubCharacter`), plus:
- `MAX_CARD_BYTES = 8 * 1024 * 1024`; larger input → `null` with reason.
- `fetchChubCharacter` refuses hosts other than `chub.ai`, `www.chub.ai`, `api.chub.ai`, `avatars.charhub.io`.
- `toCardV2(c: RpCharacter, lore?: ParsedLorebook): object` — Tavern V2 export.

**Tests:** V2 JSON → fields mapped incl. alternate greetings; V1 flat JSON accepted; PNG with chunk parsed; PNG without chunk / random bytes / JSON without name → null; embedded `character_book` → ParsedLorebook with entries; `extractChubFullPath("https://chub.ai/characters/a/b")` → "a/b", non-chub URL → null; `toCardV2` round-trips through `parseCardObject`.

Commit: `feat(rp): card import/export`.

### Task 4: Store (characters, chats, messages, swipes)
**Files:** Create `studio/src/lib/rp/store.ts`, `studio/src/lib/rp/store.test.ts`.

**Produces:** `class RpStore(db)` with:
- `characters(): RpCharacter[]`, `character(id)`, `saveCharacter(c: Partial<RpCharacter> & {name: string}): number`, `deleteCharacter(id): string[]` (returns avatar/image files no longer referenced).
- `personas()`, `savePersona`, `lorebooks()`, `lorebook(id)` with entries, `saveLorebook`, `saveEntry`, `deleteEntry`.
- `chats(characterId)`, `chat(id)`, `createChat(characterId, personaId?)` (inserts first message = card's first_message, alternate greetings as swipes), `updateChat(id, patch)`, `deleteChat(id)`.
- `messages(chatId): RpMessage[]` (swipes parsed).
- `version(chatId)`: chat `updated_at`.
- `append(chatId, role, content, expect?)`, `addSwipe(msgId, content, expect?)`, `pickSwipe(msgId, index, expect?)`, `edit(msgId, content, expect?)`, `rewind(chatId, afterMsgId, expect?)` — each in a transaction, returns `false` on stale `expect`, bumps `updated_at` strictly increasing (as `ThreadStore.replace`).

**Tests:** createChat seeds greeting with alt greetings as swipes; addSwipe appends and selects it, content follows active swipe; pickSwipe out of range → false; edit changes active swipe text only; rewind removes later messages only; stale expect → false and no change; deleteChat cascades messages.

Commit: `feat(rp): store`.

### Task 5: Model tiers and heavy mode
**Files:** Create `studio/src/lib/tiers.ts`, `studio/src/lib/tiers.test.ts`; Modify `studio/src/lib/llm.ts` (`chatStream(system, messages, opts?: { model?: string; options?: Record<string, unknown>; stop?: string[] })`; add `embed(model, texts): Promise<number[][]>` via `/api/embed`), `studio/scripts/power.sh` (add `heavy`: unload BRAIN_MODEL, stop caption + tipo; `light` = `up`).

**Produces:**
- `tierModel(tier: "quick" | "everyday" | "heavy", get = getSetting): string`.
- `withHeavy<T>(fn: () => Promise<T>, deps = { power, freeRam }): Promise<T>` — refcounted: first caller runs `power("heavy")`, last finisher schedules restore after 10 min idle; errors in `fn` still release; `onStatus` callback text "Paused captioner + TIPO for the heavy model".
- `ensureLight()` — cancels the idle timer and runs `power("up")` if paused; called by caption/TIPO/copilot routes before use.

**Tests (fake deps, fake timers):** tierModel defaults and overrides; two overlapping `withHeavy` → `power("heavy")` once; restore once after both finish + idle; `fn` throws → still released; `ensureLight` while paused → `power("up")` once and state light.

Commit: `feat(studio): model tiers + heavy mode`.

### Task 6: Story taste
**Files:** Modify `studio/src/lib/taste.ts`, `studio/src/lib/taste.test.ts`, `studio/src/lib/learning.ts`.

**Produces:**
- `TasteEvent` gains `source?: "tag" | "rp"`; `profile()` ignores `source === "rp"`.
- `storyBlock(events: TasteEvent[]): string` — RP events only: last 8 liked notes / 5 disliked notes, each ≤200 chars, block ≤1500 chars, `""` when none.
- `learning.recordEvent(kind, tags, note, persona, source = "tag")`; `learnedStoryBlock()`; companion chat system prompt includes `learnedStoryBlock()`.

**Tests:** rp events don't change tag profile; tag events don't appear in storyBlock; caps hold with 100 long notes; empty → "".

Commit: `feat(studio): story taste from RP feedback`.

### Task 7: Voice lines and memory
**Files:** Create `studio/src/lib/rp/voice.ts`, `studio/src/lib/rp/memory.ts`, tests for both.

Port `voice.ts` and `memory.ts`, replacing repo/provider calls with injected deps.
- `rankVoiceLines(query: number[], lines: {text, context, embedding: Buffer|null, embedModel}[], model, k = 4)` — pure cosine top-k, skips null / other-model vectors.
- `selectVoiceLines(store, characterId, userText, deps)` — embeds the query; embed failure → `[]`.
- `foldPlan(messages, summarizedThrough, maxFold = 60)` — pure: which turns to fold now.
- `summarizeChat(chatId, deps)` — everyday tier, detached, failure ignored.

**Tests:** ranking order by cosine; skipped vectors; empty when no lines; Float32 LE decode matches Delfino's encoding; foldPlan returns only turns past the mark, capped at 60.

Commit: `feat(rp): voice lines + memory`.

### Task 8: RP API
**Files:** Create under `studio/src/app/api/rp/`: `characters/route.ts` (GET list, POST save), `characters/[id]/route.ts` (GET, DELETE), `characters/[id]/export/route.ts`, `import/route.ts` (multipart PNG/JSON or `{url}`), `chats/route.ts` (GET by character, POST create), `chats/[id]/route.ts` (GET messages+version, PATCH, DELETE), `chats/[id]/send/route.ts` (stream), `messages/[id]/route.ts` (PATCH edit / swipe pick), `lorebooks/...`, `personas/route.ts`, `voice-lines/route.ts`, `feedback/route.ts`, `images/route.ts` (read-only list), `files/[...path]/route.ts` (serves `data/rp/` with path containment); `studio/src/lib/rp/server.ts` (singleton `RpStore`, RP settings read from `rp:settings`).

Send flow: load chat → voice lines → `assembleMessages` (with `learnedStoryBlock()`) → `withHeavy(() => chatStream(..., { model: chat.model ?? tierModel("heavy") }))` streamed as text with an `X-Status` first line for pause notes → on completion `append` (or `addSwipe` for regenerate) with `expect` → fire `summarizeChat`. Errors after the user message was saved keep it.

**Tests:** `files` path containment helper (`../` rejected); import route handler unit for size cap and bad input (handler logic in `lib/rp/import.ts`, tested directly).

Commit: `feat(rp): API`.

### Task 9: Character studio
**Files:** Create `studio/src/lib/rp/ingest.ts` (port `ingest/html.ts` + `ingest/distill.ts`), `studio/src/lib/rp/draft.ts` (port `studio/draft.ts`), tests; routes `api/rp/studio/research`, `api/rp/studio/draft`, `api/rp/studio/analyze`.

Uses heavy tier via `withHeavy`. Distilled voice lines are returned for review, saved only on the owner's save.

**Tests:** `wikitextToText` keeps quotes and drops templates; `htmlToText` strips script/style; `wikiApiUrl` for fandom URLs; `chunkText` sizes; `extractJson` pulls JSON from fenced/chatty replies; `coerceCard` fills missing fields; fetched page over the cap is cut.

Commit: `feat(rp): character studio`.

### Task 10: Migration script
**Files:** Create `studio/scripts/migrate-delfino.mjs`, `studio/src/lib/rp/migrate.ts` (pure mapping + `runMigration(src, dst, files, opts)`), `studio/src/lib/rp/migrate.test.ts`.

- Opens Delfino DB `readonly`, Studio DB normal. Dry run prints a table of planned counts (incl. skipped soft-deleted). `--apply`: copy avatars/images to `data/rp/` (sha-256 verified), then one transaction inserting all rows with id remapping (`characters`, `personas`, `lorebooks`, `lorebook_entries`, `voice_lines` with embeddings, `chats`, non-deleted `messages`, `generated_images` → `rp_images` with remapped chat/message ids or null), copies Delfino `settings` row into `rp:settings` JSON, writes `rp_meta.migrated_from`, then copies `delfino.db` to `data/rp/delfino-archive.db` via SQLite backup API. Transaction failure → copied files removed.
- Re-run with marker present → exits non-zero "already migrated".

**Tests (fixture DBs created in test from Delfino's schema text):** counts match; deleted message skipped; swipes + active index intact; ids remapped (character→lorebook, chat→persona, image→message); second run refuses; injected failure on the last insert → destination row counts unchanged and copied files removed.

Commit: `feat(rp): Delfino migration`.

### Task 11: RP screen
**Files:** Create `studio/src/components/rp/RpScreen.tsx`, `Gallery.tsx`, `RpChat.tsx`, `CharacterSheet.tsx`, `LoreEditor.tsx`, `VoiceLines.tsx`, `StudioPane.tsx`; Modify `TabBar.tsx` (5 tabs, RP icon), the page that switches tabs, `CameraRoll.tsx` (RP filter: read-only grid from `/api/rp/images`, no selection controls), `SettingsSheet.tsx` (model tier selects).

- Gallery: card grid (avatar, name, tags, last chat), Import (file or URL), New.
- Chat: messages with swipe ← n/m →, edit, regenerate, rewind ("delete after"), like/dislike with optional note → `/api/rp/feedback`, persona picker, pinned editable summary, status line from `X-Status`, 409 → "Updated on another device — Reload".
- Sheet: Card fields (core ones; others kept untouched), Lorebooks, Voice lines (embedded ✓ / re-embed), Studio (research URL → draft → review → save), Export.
- Uses `requestJson`, `Sheet`, existing tokens; touch targets ≥44px; `data-noswipe` on horizontal swipe controls.

Verification: temp dev server on a **copy** of the DB (`REPO_DIR` pointed at a scratch copy containing `data/studio.db` migrated by `--apply` on the copy), screenshots via Chrome at phone width.

Commit: `feat(rp): RP tab`.

### Task 12: Cydonia vs APEX A/B
**Files:** Create `studio/scripts/rp-ab.mjs`.

Reads 3 characters chosen by most messages from the migrated scratch copy, runs 6 fixed user turns each through `assembleMessages` (via `npx tsx`) on `cydonia-24b:latest` and `gemma4-26b-apex:latest` (power heavy first, light after), records tok/s and text, writes `scratchpad/rp-ab.html` side by side. Owner picks; `model.heavy` set via Settings. No model deletion.

Commit: `feat(rp): A/B script`.

### Task 13: Verify, review, ship
- Full `npm test`, `npm run build`.
- Fresh reviewer (agent-skills:code-reviewer, Opus) with the Review focus above; fix Critical/Important with RED→GREEN tests.
- Merge `rp-merge` → main (ff), `npm run deploy`.
- Ask the owner before `migrate-delfino --apply` on the real DB; run dry run first and show counts.
- Run the A/B and show the report; ask which to keep.
