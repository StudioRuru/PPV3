# RP merge (Delfino → Studio) — Design

> Approved in chat 2026-10-14. Sub-project 7 of the vertically integrated app (6 = mascot, ComfyUI gets its own spec). Approach A: port Delfino's worthy features into Studio natively, migrate all data, retire Delfino later on explicit approval.

## Goal
One app. Roleplay moves from Project Delfino Plaza into NAI V5 Studio as an **RP** tab, with all existing data carried over, a model tier system so light features use light models and long RP uses the heavy one, and the companion learning from RP as well as from tags and images.

## Decisions (from the owner)
- Day-1 features: characters + Tavern/Chub import, lorebooks + chat memory, character studio + voice lines. **Not** contextual RP images or poses (they belong to the ComfyUI spec).
- Migrate everything; Delfino keeps its copy until retirement is approved.
- RP model: A/B Cydonia 24B vs APEX on real characters; keep the winner; deleting the loser is a separate step needing the owner's yes.
- One companion learns everywhere; RP characters are roles, their feedback feeds the same store.

## 1. Shape
- Tab bar: Studio · Camera roll · Closet · Chat · **RP** (swipe navigation unchanged).
- RP views: **gallery** (character cards, import button) → **chat** (per character, chat list) → **character sheet** (tabs: Card · Lorebooks · Voice lines · Studio).
- Storage: Studio's existing `better-sqlite3` DB, idempotent `migrateRp(db)` called from `lib/db.ts` like `migrateChat`. No Drizzle.
- Tables: `rp_characters`, `rp_personas`, `rp_chats`, `rp_messages` (with `swipes` JSON + `swipe_index`), `rp_lorebooks`, `rp_lore_entries`, `rp_character_lorebooks` (link), `rp_voice_lines` (embedding BLOB + `embed_model`), `rp_images` (file, message id, prompt).
- Files: `data/rp/avatars/`, `data/rp/images/`, `data/rp/delfino-archive.db`.

## 2. Features
- **Cards:** import Tavern V2 / Chub from URL, PNG (tEXt `chara`) or JSON; export as V2 JSON. Fields: name, description, personality, scenario, first message, alternate greetings, example dialogue, system prompt, post-history instructions, tags, avatar.
- **Lorebooks:** entries with keys, content, enabled, order; triggered by keyword match over the last N messages; injected under a token budget (oldest-priority dropped first).
- **Memory:** when history exceeds the context budget, older turns are summarized by the brain (port of `summarizeChat`) into the chat's `summary`, shown pinned and editable; prompt = card + summary + recent turns.
- **Chat:** stream replies; swipes (regenerate adds an alternative, ← → picks one); edit any message; rewind (delete everything after a message); user persona (name + description) selectable per chat; `{{char}}`/`{{user}}` substitution.
- **Voice lines:** per-character lines with optional context; each turn the top-k most similar to the user's message (cosine on `bge-m3` vectors) are shown to the model as voice reference; lines without a vector for the current embed model are skipped, never break a turn; re-embed on demand.
- **Character studio:** research from a URL (Fandom via `api.php` wikitext, other pages flattened, size-capped) → distilled notes → drafted card + analysis + suggested voice lines, all editable before saving.

## 3. Companion and learning
- Like/dislike on an RP reply (+ optional note) → taste event with `source: 'rp'` in the existing taste store.
- `storyBlock(events)`: the latest RP likes/dislike notes summarised into a capped "how they like stories" block; added to the companion's prompt and to RP system prompts.
- The tag profile ignores `source: 'rp'` events; the story block ignores tag events.

## 4. Model tiers
- Settings keys `model.quick`, `model.everyday`, `model.heavy`; defaults: 12B / 12B / A/B winner (APEX until decided). `tierModel(tier)` reads them; co-pilot uses everyday, RP and character studio use heavy, summaries use everyday.
- Heavy on 24 GB: before a heavy request the server pauses ToriiGate and TIPO and unloads the everyday brain (same mechanism as `power.sh`), then reports it in a status line. The next tagger/caption/TIPO need (or leaving RP) restores them like `power.sh up`. Concurrent heavy requests share one pause.
- A/B: `scripts/rp-ab.mjs` runs 6 scripted turns on 3 real characters per model, writes a side-by-side HTML report with tok/s to the scratchpad; owner picks; the setting is updated; deleting the loser needs a separate yes.

## 5. Migration
- `scripts/migrate-delfino.mjs`: opens `delfino.db` read-only; **dry run by default** (prints planned counts); `--apply` writes in one transaction and copies files.
- Expected counts: 19 characters, 32 chats, 449 messages, 5 lorebooks, 161 lore entries, 1 persona, 11 voice lines (with vectors), 183 images; avatars and images copied with SHA-256 verified.
- Refuses to run twice (marker row `rp_meta.migrated_from`). Soft-deleted Delfino rows are skipped and counted separately.
- Images stay attached to their messages and appear in Camera roll under an **RP** filter.
- Full copy of `delfino.db` saved as `data/rp/delfino-archive.db` (poses, settings).
- Delfino untouched. Retirement (LaunchAgent, port 3000, Tailscale root, Cydonia/dolphin models) only on the owner's explicit yes after parity.

## 6. Error handling
- Bad card (no name / malformed PNG chunk / non-card JSON) → readable error, nothing saved. Chub URL fetch failure → readable error.
- Embed model missing → voice lines skipped, status note.
- Heavy model fails to load (RAM) → error with "Heavy needs captioner + TIPO paused" and a retry; nothing lost (the user message stays).
- Stale writes: chat saves carry a version like Chat 2.0 threads (409 on stale).
- Card text, lore and wiki notes are data in prompts, quoted, not instructions to the app.

## 7. Testing
- TDD (vitest, in-memory DB) for: card parsing (V2 JSON, PNG chunk, bad input), lore trigger + budget, summary windowing, swipe/edit/rewind storage, voice ranking, story block caps and source separation, tier selection, migration mapping on a fixture DB (counts, skip deleted, refuse twice).
- Live checks on a temp dev server (`APP_PASSWORD= npx next dev -H 127.0.0.1 -p 3104`) only after migration was applied with the owner's OK; no DELETE tests on real data.

## Out of scope
Contextual RP images and poses, ComfyUI, the mascot UI, Delfino retirement.
