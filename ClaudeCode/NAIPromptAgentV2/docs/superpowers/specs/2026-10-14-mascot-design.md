# Mascot (Miyabi) — Design

> Approved in chat 2026-10-14. Sub-project 6. One companion that lives in the app: floating, bratty, reacts to what you do, remembers you.

## Decisions (from the owner)
- **Character:** Hoshimi Miyabi (Zenless Zone Zero), canon adult. No added negative/age tags in her prompt (owner's call).
- **Voice:** full brat — smug, flirty, teasing, mocking, playful, loud. Flirt/tease intensity follows the existing modifiers + learned boldness.
- **Rating:** matches the app (NSFW allowed).
- **Look:** NAI-drawn expression sprites, two outfit sets: canon default by day, sleepwear at night.
- **Placement:** floating corner on every tab, Clippy-style.
- **Triggers:** generations, editing, idle/time, RP and chat.
- **Chattiness:** smart cap + hush + slider.
- **Models:** quips on Gemma 4 E4B (`hf.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF:Q4_K_M`, pulled 2026-10-14) as the `quick` tier; deep talk on APEX (heavy tier, via HeavyGate).

## 1. Sprites
- Expressions (9): smug, laughing, wink, pout, flirty, shocked, annoyed, excited, sleepy. Outfits: `day` (canon: white shirt, black tie, aqua jacket off one arm, gauntlet, long black skirt), `night` (sleepwear).
- Prompt: fixed Miyabi base prompt + outfit tags + per-expression tags, `simple background, white background`, portrait 832×1216, 28 steps, fixed seed per outfit (expression only changes the tags). Owner can edit the base prompt in the mascot studio.
- **Mascot studio** (Settings → Mascot): pick an expression → generate N candidates (default 3) → pick one → background removed → saved as `data/mascot/<outfit>/<expression>.png`. Shows Anlas balance before/after a batch (portrait 28-step should be free on Opus; any non-zero cost is shown before spending more).
- **Background removal:** anime-segmentation ONNX (`skytnt/anime-seg` isnetis, ~170 MB) served by the tagger sidecar (`POST /cutout`), returns a transparent PNG; the original is kept beside it.
- Missing sprites fall back to the nearest available expression, then to a lettered placeholder.

## 2. Floating Miyabi
- Fixed above the tab bar, bottom-right by default; drag to any corner (remembered per device). Size ~96 px tall on phones.
- Speech bubble beside her; fades after a read-time based on length; tapping the bubble dismisses it.
- Idle life: expression returns to `smug` after a quip; gentle bob (CSS); occasional sleepy at night.
- Outfit: `night` between the configured hours (default 23:00–07:00), else `day`.
- Hush: swipe her down (or long-press → Hush) = silent for 30 min; she shows a small "zzz".
- Layering: she stays visible when sheets/viewer open but sits below them (z-index), and never over the composer.
- Never covers inputs: she moves up when the keyboard/composer is focused, and never speaks while the user is typing (any focused text field).

## 3. Quips
- Events (client → `/api/mascot/quip`): `generated {tags, cost, count}`, `upscaled {factor, mb}`, `error {where, message}`, `applied {ops}`, `prompt_edit {added, removed}`, `closet_use {kind, name}`, `idle {minutes}`, `greet {hour, sinceLast}`, `rp_feedback {kind, note, character}`, `rp_chat {character}`, `tap` (no event).
- **Gate (client, pure `shouldSpeak`):** respects hush; never while typing; cooldown from the chattiness slider (default 120 s, slider 30 s–10 min, or "only when tapped"); priority events (error, first generation of a session, greet) may bypass half the cooldown; at most one request in flight; drops stale events (>30 s old).
- **Server:** builds a short prompt (Miyabi persona + modifiers/boldness + the event as data + current prompt summary + tag taste + story block + memory) and asks the quick tier for one line, `max 2 sentences`, format `[expression] text`. `parseQuip` maps unknown/missing expressions to `smug`, strips quotes/role prefixes, caps length (~220 chars). E4B offline → canned fallback line for that event (small built-in pool) so she never errors visibly.
- Quips are journaled (event + line).

## 4. Deep talk
- Tap Miyabi → Miyabi sheet: her portrait (current expression), a chat thread (stored as a normal Chat 2.0 thread with persona `miyabi`), composer. Replies stream on the heavy tier through HeavyGate (status line when servers pause).
- She can suggest prompt changes; patch ops are shown as PatchCards like Chat (same parser), so "fix my prompt" works there too.
- Like/dislike in this sheet records taste events (source `tag` for change cards, `rp` style notes for talk) — same store as everywhere.
- Persona `miyabi` is added to the Chat persona list too (so threads open in either place).

## 5. Memory
- `mascot_journal` (time, event kind, short summary, her line), capped to the last 300 rows.
- `mascot_facts`: up to 12 short facts about the owner ("loves torn clothing tags", "generates late at night", "named their RP barista Bertha's owner"). Refreshed by the quick tier from the journal + taste after every 25 journal rows or daily; facts are data in prompts; viewable/editable/clearable in Settings → Mascot.
- Prompt budget: facts ≤ 1200 chars, last 5 journal lines ≤ 600 chars.

## 6. Settings → Mascot
Show/hide Miyabi, chattiness slider (incl. only-when-tapped), night hours, hush now, quick model picker (default E4B), base prompt editor + mascot studio, memory facts (edit/delete/clear).

## 7. Error handling
- Sprite generation failure → readable error in the studio, nothing replaced. Cutout server down → keep the original (non-transparent) with a note.
- Quick model missing/offline → canned lines; deep talk offline → error in the sheet.
- Quip requests are fire-and-forget; failures never show errors in the floating bubble.

## 8. Testing
- TDD: `shouldSpeak` (hush, typing, cooldown, priority, in-flight, stale), `parseQuip`, `outfitFor(hour, window)`, `pickSprite` fallback, event → prompt builder (data quoted, caps), journal/facts caps and refresh trigger, canned fallback selection.
- Sprite pipeline verified on one portrait (cost shown) before any batch; cutout checked on that portrait.
- Live check on a temp dev server: floating position on phone width, bubble timing, hush, a real E4B quip.

## Out of scope
Animated/Live2D motion, voice (TTS), ComfyUI-generated sprites (ComfyUI spec), mascot on the iOS share extension.
