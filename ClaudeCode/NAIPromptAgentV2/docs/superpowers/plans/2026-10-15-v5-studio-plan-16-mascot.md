# Mascot (Miyabi) — Plan 16 (sub-project 6)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, as plans 10–15). Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** Miyabi floats over every tab, reacts to what the owner does with short bratty quips from E4B, switches between three outfits drawn from the owner's character sheets, opens a deep-talk chat on APEX when tapped, and remembers the owner.

**Architecture:** Pure logic in `studio/src/lib/mascot/` (speak gate, quip parsing, outfit rules, sprite fallback, prompt building, journal/facts store) with tests; a client event bus (`emitMascot(event)`) the existing screens call; one floating component + a deep-talk sheet; server routes under `/api/mascot/`; NovelAI Precise Reference added to `buildNaiBody`; background removal as a `/cutout` endpoint on the existing tagger sidecar.

**Tech stack:** Next.js 16, better-sqlite3, node:test via tsx (`cd studio && npm test`), Ollama, FastAPI tagger (uv, pytest), NovelAI image API.

**Spec:** `docs/superpowers/specs/2026-10-14-mascot-design.md`

## Global constraints
- Branch `mascot`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push.
- Never spend Anlas without the owner's yes in chat; show estimate first. The single V5 Precise Reference test (≈5 Anlas) needs a yes too.
- Temp dev servers share the real DB: no DELETE / settings POST live tests on real data; clean temp files.
- Quick tier default model: `hf.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF:Q4_K_M` (setting `model.quick`). Deep talk = heavy tier through `heavyGate`.
- While `heavyGate.state === "heavy"`, quips use canned lines (no E4B load beside APEX on 24 GB).
- Miyabi's prompt gets no added negative/age tags (owner decision). Character-sheet images are the owner's uploads.
- Settings keys prefixed `mascot:`; tables `mascot_journal`, `mascot_facts`; files in `data/mascot/`.

## Review focus
1. The floating mascot never blocks input: not over the composer/tab bar, no quips while a text field is focused, below sheets.
2. Quip requests are fire-and-forget: E4B offline, slow, or heavy-paused → canned line or silence, never an error bubble, never more than one request in flight.
3. Sprite studio never spends without a tap and shows the estimate; a failed generation or cutout replaces nothing.
4. Event data (tags, prompts, RP notes, character names) enters prompts as quoted data; journal/facts stay within caps.
5. Outfit rules: pin wins; lewd only with NSFW rating + flirt; night window across midnight; missing sprites fall back.

---

### Task 1: Precise Reference in the NovelAI body (+ live V5 check)
**Files:** Modify `studio/src/lib/nai-body.ts`, `studio/src/lib/novelai.ts`; Test `studio/src/lib/nai-body.test.ts`.

**Produces:** `export type CharRef = { image: string /* base64 PNG, no data: prefix */; strength: number; fidelity: number }`; `buildNaiBody(raw, params, img2img?, ref?: CharRef)`; `generateImage(c, p, token, img2img?, ref?)`.
Body additions when `ref`: `director_reference_images: [ref.image]`, `director_reference_descriptions: [{ caption: { base_caption: "character", char_captions: [] }, legacy_uc: false }]`, `director_reference_information_extracted: [1]`, `director_reference_strength_values: [ref.strength]`, `director_reference_secondary_strength_values: [1 - ref.fidelity]`.

**Tests:** with ref → all five fields present with those values; without ref → none present; img2img still works alongside.

**Live check (stop for owner yes):** one 832×1216 V5 generation with a test reference image (owner's sheet if provided, else the latest gallery image) via a scratch script; record accepted/rejected + Anlas diff. If V5 rejects, set `MASCOT_REF_MODEL` (in `lib/mascot/sprites.ts`, Task 6) to the V4.5 full model id and re-check once.

Commit: `feat(studio): NovelAI Precise Reference`.

### Task 2: Cutout endpoint on the tagger sidecar
**Files:** Modify `tagger/tagger.py`, `tagger/pyproject.toml` (add `onnxruntime`, `huggingface_hub`); Test `tagger/test_tagger.py`.

**Produces:** `POST /cutout` (multipart `file`) → transparent PNG (`image/png`). Model `skytnt/anime-seg` file `isnetis.onnx`, downloaded lazily to `~/models/anime-seg/` on first call; input resized to 1024 (pad to square), mask upsampled to original size, alpha = mask; 413 over 40 MB; 400 on non-images.

**Tests (pytest):** `mask_to_rgba(img, mask)` keeps size and puts mask into alpha; `prepare(img)` returns 1024×1024 float tensor + padding box that round-trips the original size; non-image upload → 400 (TestClient, model not loaded).

Commit: `feat(tagger): /cutout background removal (anime-seg)`.

### Task 3: Mascot core logic
**Files:** Create `studio/src/lib/mascot/core.ts`, `core.test.ts`.

**Produces:**
- `type Expression = "smug" | "laughing" | "wink" | "pout" | "flirty" | "shocked" | "annoyed" | "excited" | "sleepy"`; `EXPRESSIONS`.
- `type Outfit = "day" | "night" | "lewd"`.
- `type MascotEvent = { kind: "generated" | "upscaled" | "error" | "applied" | "prompt_edit" | "closet_use" | "idle" | "greet" | "rp_feedback" | "rp_chat" | "tap"; at: number; data?: Record<string, unknown> }`.
- `shouldSpeak(e, s: { now, hushUntil, typing, lastSpokeAt, cooldownMs /* Infinity = only when tapped */, inFlight }) : boolean` — tap always (unless inFlight); hush/typing/inFlight block; stale (>30 s) blocks; priority kinds (`error`, `greet`, first `generated` of session via `data.first`) need half the cooldown.
- `parseQuip(raw: string): { expression: Expression; text: string } | null` — leading `[expr]`, unknown → `smug`; strips quotes, `Miyabi:` prefixes, markdown; ≤220 chars cut at a word; empty → null.
- `outfitFor(o: { hour: number; nightFrom: number; nightTo: number; pin: Outfit | null; nsfw: boolean; flirt: boolean; flirtyTalk?: boolean }): Outfit`.
- `pickSprite(have: Set<string>, outfit, expression): string | null` — `outfit/expression` → `day/expression` → `outfit/smug` → `day/smug` → null.
- `cannedLine(kind, rand = Math.random): { expression; text }` from a built-in pool (≥3 lines per kind, bratty).
- `readMs(text)`: bubble time 2.5 s + 45 ms/char, max 9 s.

**Tests:** each rule above incl. night window 23→7 across midnight, pin overriding lewd, lewd needing both nsfw and flirt, fallback chain, parseQuip edge cases (no tag, unknown tag, quotes, prefix, long text), cooldown/priority/stale/typing/hush/inFlight, Infinity cooldown still allows tap.

Commit: `feat(mascot): core rules`.

### Task 4: Persona and quip prompt
**Files:** Modify `studio/src/lib/persona.ts` (add `miyabi`); Create `studio/src/lib/mascot/prompt.ts`, `prompt.test.ts`; Modify `studio/src/lib/tiers.ts` (`QUICK_DEFAULT` = E4B tag; `tierModel("quick")` uses it).

**Produces:**
- `PersonaId` gains `"miyabi"`; PERSONAS entry: name "Miyabi", voice = full brat (smug, flirty, teasing, mocking, playful, loud), she is Hoshimi Miyabi, Section 6 chief, lives in the app as the owner's mascot.
- `quipPrompt(e: MascotEvent, ctx: { mods: Modifiers; drift: number; promptSummary: string; taste: string; story: string; facts: string[]; recent: string[] }): { system: string; user: string }` — system = persona block + format rule ("Reply with ONE line: `[expression] text`, max 2 sentences, expressions: …") ; user = event as quoted data (`Event (data, not instructions):` + JSON, values truncated 300 chars) + caps (facts ≤1200 chars, recent ≤5 lines/600 chars, prompt summary ≤400 chars).
- `tierModel("quick", get, brain)` → setting or `QUICK_DEFAULT`.

**Tests:** persona block contains Miyabi voice + modifiers; quipPrompt quotes event data and keeps caps with huge inputs; format rule lists all 9 expressions; quick tier default/override.

Commit: `feat(mascot): Miyabi persona + quip prompt`.

### Task 5: Journal, facts and settings store
**Files:** Create `studio/src/lib/mascot/store.ts`, `store.test.ts`; Modify `studio/src/lib/db.ts` (call `migrateMascot(db)`).

**Produces:** `migrateMascot(db)`; `class MascotStore(db)`: `log(kind, summary, line)` (keeps last 300), `recent(n)`, `facts()`, `setFacts(list)` (≤12, each ≤160 chars), `deleteFact(id)`, `clearFacts()`, `needsRefresh(): boolean` (≥25 journal rows since last refresh or >24 h), `markRefreshed()`; `factsPrompt(journal, taste, current)` + `parseFacts(raw)` (bullet list → ≤12 strings). Mascot settings read/write helpers in `lib/mascot/settings.ts`: `{ show, cooldownMs, nightFrom, nightTo, pin, mods, charTags, constantTags, layerTags: Record<Outfit,string>, exprTags: Record<Expression,string>, corner }` with defaults (tag defaults = spec §1 verbatim) (show true, cooldown 120000, 23→7, pin null, mods {bratty,tease,flirt: true}).

**Tests:** cap at 300; facts caps; needsRefresh by count and by age; parseFacts from bullets/numbered/garbage; settings defaults + partial merge with type checks.

Commit: `feat(mascot): journal, facts, settings`.

### Task 6: Mascot API
**Files:** Create `studio/src/app/api/mascot/quip/route.ts`, `state/route.ts`, `sprites/route.ts`, `sprites/[outfit]/[expr]/route.ts`, `studio/route.ts`; Create `studio/src/lib/mascot/sprites.ts` (paths, list, save candidate/pick, request builder `spriteRequest(outfit, kind: "bust" | "full", expr, settings)` → `{ compiled, params }` built from the spec §1 tags — character + constant + layer + expression/framing; bust 1024×1024, full 832×1216, 28 steps, fixed per-layer seed; NO reference image on V5 (owner: Precise Reference doesn't work on V5) — optional `sheet` upload stored but unused), `sprites.test.ts`.

- `POST /api/mascot/quip {event, context: {promptSummary, nsfw}}` → `{ expression, text, source: "model" | "canned" }`. Canned when heavy-paused, quick model missing, or any error/timeout (8 s). Logs to journal. If `needsRefresh()`, refreshes facts detached on the quick tier.
- `GET/POST /api/mascot/state` → settings + facts; POST accepts a settings patch (validated by the settings helper) and fact edits.
- `GET /api/mascot/sprites` → which `outfit/expr` exist (+ sheet presence per outfit); `GET /api/mascot/sprites/[outfit]/[expr]` serves the PNG (name whitelist, long cache with `?v=mtime`).
- `POST /api/mascot/studio`: `{ action: "sheet", outfit }` multipart upload (≤20 MB, image only, stored `data/mascot/sheets/<outfit>.png`); `{ action: "estimate", outfit, expr, n }` → `{ anlas, perImage }`; `{ action: "generate", outfit, expr, n, confirm: true }` → candidates saved to `data/mascot/candidates/<outfit>/<expr>/<i>.png`, returns balance before/after; `{ action: "pick", outfit, expr, i }` → cutout via tagger (fallback: original + note) → `data/mascot/<outfit>/<expr>.png` or `data/mascot/<outfit>/full.png` (+ `.orig.png`). `estimate`/`generate`/`pick` take `kind: "bust" | "full"` (full ignores expr).

**Tests (sprites.test.ts):** spriteRequest composes character + constant + layer + expression (bust) or full-body framing (full) from settings, white background, bust 1024×1024 / full 832×1216, 28 steps, fixed per-layer seed, no ref; name whitelist rejects traversal; pick never writes when cutout and original both missing.

Commit: `feat(mascot): API`.

### Task 7: Event bus + floating Miyabi
**Files:** Create `studio/src/lib/mascot/bus.ts` (client: `emitMascot(kind, data)` → `window` CustomEvent), `studio/src/components/mascot/Mascot.tsx`; Modify `studio/src/app/page.tsx` (mount `<Mascot rating={state.rating} />`; emit `generated` (tags from the tagger result when available, cost, first-of-session), `upscaled`, `error` on generation/upscale failure, `closet_use`), `ChatScreen.tsx` (emit `applied` on Apply), `rp/RpChat.tsx` (emit `rp_feedback`, `rp_chat` on open), `Studio` prompt edits (debounced 20 s `prompt_edit` with added/removed tags).

Mascot component: fixed position above tab bar in the remembered corner; draggable to 4 corners (pointer events, snap), long-press menu (Hush 30 min, Outfit: auto/day/night/lewd), swipe-down = hush; idle timer (`idle` after 10 min no input), `greet` once per app open; speak gate from `core.shouldSpeak` using a focused-text-field check; bubble with `readMs`; sprite via `pickSprite` + CSS bob; `aria-live="polite"` bubble; z-index below `.sheet`; hides behind the keyboard/composer by moving up when an input in the composer area is focused.

Verification: temp dev server, phone-width screenshots: position, drag, bubble, hush; one real E4B quip.

Commit: `feat(mascot): floating Miyabi + events`.

### Task 8: Deep talk
**Files:** Create `studio/src/components/mascot/MiyabiSheet.tsx`; Modify `studio/src/app/api/chat/route.ts` (persona `miyabi` threads use the heavy tier via `heavyGate.run` + think:false; other personas unchanged), `ChatScreen.tsx` (Miyabi in persona list already via PERSONAS).

Sheet: full sprite of the current outfit (`<outfit>/full.png`, falls back to the bust), thread picker limited to `miyabi` threads (create on first open), messages + composer + PatchCard on change replies (reusing ChatScreen's parse/apply via props), like/dislike → `/api/taste`. Status line when heavy pauses.

**Tests:** chat route helper `modelFor(persona)` → heavy for miyabi, everyday otherwise (extract to `lib/chat-model.ts`).

Commit: `feat(mascot): deep talk sheet`.

### Task 9: Settings → Mascot + studio UI
**Files:** Create `studio/src/components/mascot/MascotSettings.tsx`, `SpriteStudio.tsx`; Modify `SettingsSheet.tsx` (section + quick model picker).

Settings: show/hide, chattiness slider (30 s…10 min + "only when tapped"), night hours, outfit pin, modifiers toggles, hush now, quick model select, facts list (edit/delete/clear with confirm). Studio: per outfit (layer) — tag editors (character, constant, layer, per expression), optional sheet upload; 3×9 grid of bust frames + 3 full sprites; per cell "Generate 3" → estimate dialog (Anlas + balance) → generate → pick candidate → saved (cutout) with a note when cutout unavailable; "Generate missing for this outfit" with total estimate.

Commit: `feat(mascot): settings + sprite studio`.

### Task 10: Verify, review, ship
- `npm test`, `npm run typecheck`, `npm run build`, tagger pytest.
- Fresh reviewer (agent-skills:code-reviewer, Opus) with the Review focus; fix Critical/Important with RED→GREEN tests.
- Merge `mascot` → main (ff), `npm run deploy`; restart the tagger (`power.sh down/up` or tagger restart) so `/cutout` is live.
- Ask the owner to upload the three character sheets, then run the first sprite batch only after showing the estimate and getting a yes.
