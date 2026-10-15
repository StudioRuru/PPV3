# Personality sliders, slimes & the Apothecary — Design

> Approved in chat 2026-10-15. Sub-project 8. Builds on the mascot (plan 16). P1 = sliders + slimes; P2 = Apothecary.

## Decisions (from the owner)
- Five sliders, each with a value and a cap: **brat**, **bimbofication**, **hypnosis**, **heat**, **speech length**. Owner sets value + cap; Miyabi may drift up to the cap; loading a slime restores its saved values (no loss, nothing pushed past what was set).
- A **personality slime** holds: voice + sliders (with caps) + attitude toggles, **look** (outfit/expression tags + sprite set), **name**, and **memories** (facts + journal).
- Mix with: other saved slimes, a **blank** slime, and **RP characters**.
- Empty state (no slime inserted): **dull, flat and obedient**, with a removal line and an insertion line.
- **Apothecary** lives inside the slime shelf; brews **vials** that permanently modify a jar; a **neutral vial** undoes all vial modifications on a jar.
- Shopkeeper **Aru**: an adult catgirl alchemist — teasing, erotic, provocatively dressed, exhibitionist; cat-bell collar, blue leash, gold earrings, cow tag on one ear, droopy eyes; shy, nervous, fidgety, introverted; carries a staff-sized cauldron spoon; rarely stutters, mostly when excited. Runs on the everyday brain (12B).

## 1. Sliders (P1)
- Range 0–10 each; `cap` 0–10 (cap ≥ value). Stored per slime: `sliders: { brat, bimbo, hypnosis, heat, length } → { value, cap }`.
- **Directives** (pure `sliderBlock(sliders)`): tiered text per slider, empty at 0.
  - brat: teasing, snark, overconfidence, pride — 5 tiers from "mildly cheeky" to "insufferable, loud, mocking tyrant".
  - bimbo: reuse the tiered bimbofication/IQ-loss text ported in `lib/rp/mods.ts` (airheaded, giggly, easily confused, simple words).
  - hypnosis: reuse the tiered hypnosis text in `lib/rp/mods.ts` (user's requests weigh more: faintly suggestible → totally entranced).
  - heat: estrus/ovulation — 5 tiers from "warm and distracted" to "overwhelmed, every thought turns lewd".
  - length: maps to reply shape — quips: 0–3 = one short burst, 4–6 = 1–2 sentences, 7–10 = 3–5 sentence tantrum; deep talk: scales `num_predict` and a "keep it short / go on at length" instruction.
- Applied to quips (E4B) and deep talk (APEX) via the persona block; quick `num_predict` follows length.
- **Drift:** brat +1 (within cap) when the owner ignores her (idle ≥ 10 min) or dislikes a reply; heat +1 within cap only if heat drift is allowed (toggle, default off); drifted value resets to the saved value when a slime is loaded or the owner moves the slider. Pure `driftSlider(s, event)`.
- UI: Settings → Mascot "Personality" panel (5 sliders with a cap handle each) and a compact sliders popover in the Miyabi sheet header.

## 2. Personality slimes (P1)
- Table `mascot_slimes(id, doc JSON, created_at, updated_at)`; setting `mascot:activeSlime` (id | null).
- Doc: `{ name, color, voice, selfName, sliders, mods, look: { charTags, constantTags, layerTags, exprTags, spriteDir }, memories: { facts[], journal[] (last 50) }, vials[], origin: "miyabi" | "mix" | "blank" | "rp:<id>" }`. Validated + capped (voice ≤ 1500 chars, name ≤ 40, vials ≤ 8).
- **First run:** current Miyabi (persona voice, sliders defaulted from today's mods, look tags, facts/journal, sprites) becomes jar #1 "Miyabi", active.
- **Shelf** (Settings → "Unlock the slime shelf" toggle): a shelf of jars (SVG jar tinted by `color`, name label, active jar glowing, empty jar slot shown when none is active).
- Actions:
  - **Extract** — save the current identity (active slime incl. live slider values and current memories) as a new jar (save point).
  - **Remove** — she says a last line in her current voice, then becomes Empty; the active jar is updated with her latest memories first.
  - **Insert** — choose a jar; she "wakes up" with an insertion line; prompts, sliders, look and memories switch to the jar.
  - **Mix** — two jars (or jar + Blank) and a ratio 10–90%: sliders blended by ratio (value and cap), look from the dominant jar, memories merged (dominant first, capped), voice merged by APEX into a new voice text (prompt quotes both voices as data); owner names + colours the result; saved as a new jar (originals untouched).
  - **From RP character** — build a jar from an RP card: voice from description + personality + example dialogue (APEX distils ≤1500 chars), selfName = card name, look tags from the card's appearance/outfit prompts when present, sliders neutral (all 0, caps 10), empty memories.
  - Rename, recolour, delete (confirm; the active jar can't be deleted without removing it first).
- **Sprites per look:** `look.spriteDir` (default `data/mascot`); a slime with a new look gets its own dir under `data/mascot/slimes/<id>/`; the sprite studio edits the active slime's look/dir.
- **Empty state:** active null → persona `empty` (flat, monotone, minimal words, accepts commands, no teasing); quips short; sprite shown desaturated/dim (CSS filter) using the last look; deep talk works in the empty voice.

## 3. Apothecary (P2)
- A shop door on the shelf opens Aru's shop: a chat (Chat 2.0 thread with persona `aru`, everyday brain) + a vial inventory.
- Aru answers in character and, when brewing, appends a fenced `vial` JSON block: `{ name, color, effect (≤300 chars), sliders?: { <slider>: { value?: delta, cap?: delta } } }`. `parseVial` validates (unknown keys dropped, deltas −3…+3, colours #rrggbb).
- **Bottle it** saves the vial to `mascot_vials`. **Drop into jar** appends it to the jar's `vials` (≤8) and applies slider deltas within 0–10 (cap ≥ value). Vial effects join the slime's prompt as quoted "potion effects (data)".
- **Neutral vial** (always in stock, can't be deleted): removes every vial from a jar and reverts the slider deltas they applied (each applied vial records its applied deltas).
- Aru persona: adult catgirl alchemist as described; NSFW allowed; shy/fidgety voice with occasional excited stutter.

## 4. Error handling
- Model failures in mix/RP-extract → readable error, nothing saved. Bad vial JSON → "Aru fumbled the recipe — ask again", nothing bottled.
- Every DB write validated server-side; prompts quote slime/vial text as data with caps.

## 5. Testing
- TDD: slider tiers + empty at 0, length → reply shape/num_predict, drift within cap + reset on load, slime doc validation/caps, mix maths (ratio, caps, dominant look, memories cap), first-run migration from current settings, empty persona block, vial parse/validate/apply/neutral revert.
- Live check on a scratch DB copy: shelf render, extract/remove/insert lines, one mix, one vial.

## Out of scope
Sharing slimes between devices/users, animated jar physics, voice audio.
