# Mascot (Miyabi) — Design

> Approved in chat 2026-10-14. Sub-project 6. One companion that lives in the app: floating, bratty, reacts to what you do, remembers you.

## Decisions (from the owner)
- **Character:** Hoshimi Miyabi (Zenless Zone Zero), canon adult. No added negative/age tags in her prompt (owner's call).
- **Voice:** full brat — smug, flirty, teasing, mocking, playful, loud. Flirt/tease intensity follows the existing modifiers + learned boldness.
- **Rating:** matches the app (NSFW allowed).
- **Look:** NAI-drawn expression sprites in **3 outfits — day, night, lewd** — each anchored to a character sheet image the owner provides.
- **Outfit switching:** rules + manual override.
- **Placement:** floating corner on every tab, Clippy-style.
- **Triggers:** generations, editing, idle/time, RP and chat.
- **Chattiness:** smart cap + hush + slider.
- **Models:** quips on Gemma 4 E4B (`hf.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF:Q4_K_M`, pulled 2026-10-14) as the `quick` tier; deep talk on APEX (heavy tier, via HeavyGate).

## 1. Sprites
Owner supplied 11 reference sheets (2026-10-15); Precise Reference does not work on V5 right now, so sprites are built from tags analysed from those sheets (no reference image sent). Without references, 1024×1024 / 832×1216 at 28 steps is free on Opus.

**Character tags (all sprites):** `1girl, solo, hoshimi miyabi, fox girl, animal ears, fox ears, very long hair, black hair, gradient hair, purple hair tips, twintails, blunt bangs, sidelocks, red eyes, purple eyeshadow, eyeliner, fang, heart earrings, heart ear ornament, black choker, heart choker, ring, large breasts, wide hips, thick thighs, curvy`
**Constant pieces (all layers):** `black elbow gloves, fingerless gloves, black thighhighs, shiny thighhighs, lace-trimmed thighhighs, heart thigh strap, platform heels`

**Outfit layers:**
- `day` (layer 1): `white crop top, sleeveless, underboob, aqua skirt, frilled miniskirt, pleated skirt, lace panties`
- `night` (layer 2): `black leotard, latex leotard, highleg leotard, strapless leotard, plunging neckline, cleavage`
- `lewd` (layer 3): `completely nude, nipples, pussy` (with the constant pieces)

**Expressions (9) → tags:** smug `smug, smirk, half-closed eyes, fang`; laughing `laughing, open mouth, closed eyes, fang`; wink `one eye closed, tongue out, :p`; pout `pout, puffed cheeks, bubble blowing, chewing gum`; flirty `seductive smile, blush, half-closed eyes, heart-shaped pupils`; shocked `surprised, wide-eyed, open mouth, sweat`; annoyed `annoyed, frown, glaring, v-shaped eyebrows`; excited `excited, open smile, sparkling eyes, fang`; sleepy `sleepy, half-closed eyes, yawning, tears`.

**Art kinds:**
- **Bust frames** (27 = 9 expressions × 3 layers): `portrait, upper body, looking at viewer, simple background, white background`, 1024×1024 — the floating mascot and bubbles use these.
- **Full sprites** (3, one per layer): `full body, standing, hand on hip, looking at viewer, simple background, white background`, 832×1216, neutral smug — shown in the deep-talk sheet.
- 28 steps, fixed seed per layer; tags editable in the mascot studio (base, constant, per layer, per expression).

**Mascot studio** (Settings → Mascot): per layer and art kind — generate N candidates (default 3) → pick one → background removed → saved as `data/mascot/<outfit>/<expression>.png` (bust) / `data/mascot/<outfit>/full.png` (+ `.orig.png`). Shows the Anlas balance before/after a batch; any non-zero estimate needs a tap to confirm. Optional sheet upload per outfit is kept for later (if V5 Precise Reference starts working, the stored sheet can be sent via the Task 1 `CharRef`).
**Background removal:** anime-segmentation ONNX (`skytnt/anime-seg` isnetis, ~170 MB) served by the tagger sidecar (`POST /cutout`), returns a transparent PNG.
- Missing sprites fall back to the same expression in `day`, then the nearest expression, then a lettered placeholder.

## 2. Floating Miyabi
- Fixed above the tab bar, bottom-right by default; drag to any corner (remembered per device). Size ~96 px tall on phones.
- Speech bubble beside her; fades after a read-time based on length; tapping the bubble dismisses it.
- Idle life: expression returns to `smug` after a quip; gentle bob (CSS); occasional sleepy at night.
- Outfit rules (pure `outfitFor`): a pinned outfit always wins (Settings, or long-press her → outfit); else `lewd` when the Studio is in NSFW mode **and** the flirt modifier is on (or she's in a flirty deep talk); else `night` between the configured hours (default 23:00–07:00); else `day`. Pin can be cleared back to automatic.
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
Show/hide Miyabi, chattiness slider (incl. only-when-tapped), night hours, outfit pin (auto/day/night/lewd), hush now, quick model picker (default E4B), base prompt editor + mascot studio, memory facts (edit/delete/clear).

## 7. Error handling
- Sprite generation failure → readable error in the studio, nothing replaced. Cutout server down → keep the original (non-transparent) with a note.
- Quick model missing/offline → canned lines; deep talk offline → error in the sheet.
- Quip requests are fire-and-forget; failures never show errors in the floating bubble.

## 8. Testing
- TDD: `shouldSpeak` (hush, typing, cooldown, priority, in-flight, stale), `parseQuip`, `outfitFor` (pin, lewd conditions, night window across midnight), `pickSprite` fallback, event → prompt builder (data quoted, caps), journal/facts caps and refresh trigger, canned fallback selection.
- Precise Reference request body unit-tested; one live V5 test generation (≈5 Anlas, owner OK) before any batch; cutout checked on that portrait.
- Live check on a temp dev server: floating position on phone width, bubble timing, hush, a real E4B quip.

## Out of scope
Animated/Live2D motion, voice (TTS), ComfyUI-generated sprites (ComfyUI spec), mascot on the iOS share extension.
