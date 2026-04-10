# Character Appearance Interview Protocol

A structured, multi-round questioning flow for building character appearance. Used by both `/prompt` and `/story` when creating a new character from scratch.

## When to Run

- `/prompt` — "Build from character" or "Build from scenario" with no existing character
- `/prompt` — Partial input missing appearance details
- `/story` — Phase 1 Opening Interview, new character creation

## When to Skip

- **Saved character**: Loading from `data/characters/` — present saved profile, ask for modifications
- **Known game character**: User provides a Danbooru character name (e.g., `daiwa scarlet (umamusume)`) — canonical appearance auto-loaded
- **Reference image provided**: Use `/investigate` to extract tags → present summary for confirmation instead

---

## Round 0 — Intent & Tone

Ask before any appearance questions. Cascades into all subsequent rounds.

### Question 1 — Content Rating

| Rating | Description | Effect on Later Rounds |
|--------|-------------|----------------------|
| SFW | Clean illustration, no suggestive content | Body round skips chest emphasis, skin effects. States/scenarios limited to non-suggestive |
| Ecchi | Suggestive but not explicit — panty shots, cleavage, clothing damage | Body round includes chest/hip options. States include clothing damage, strap slip |
| NSFW Soft | Nudity, exposure, mild sexual content | Full body detail questions. States include all clothing removal |
| NSFW Hard | Explicit sexual content, full nudity, graphic scenarios | Full body + explicit tags unlocked. All states/scenarios available |

### Question 2 — Fetish Direction (Ecchi or higher only)

Multi-select from these categories:

| # | Category | Options | Tags It Unlocks |
|---|----------|---------|-----------------|
| 1 | **Exposure** | Exhibitionism, Public nudity, Wardrobe malfunction, Accidental exposure | `exposed`, `public`, `onlookers`, `wardrobe malfunction`, `embarrassed` |
| 2 | **Clothing** | Clothing destruction, Wet/see-through, Skin tight, Progressive stripping | `torn clothes`, `wet clothes`, `see-through`, `skin tight`, `undressing` |
| 3 | **Power dynamic** | Humiliation, Submission, Dominance, Corruption/degeneration | `humiliated`, `reluctant`, `resigned`, `heart-shaped pupils`, `empty eyes` |
| 4 | **Restraint** | Bondage, Shibari/rope, Tentacles, Restrained | `bound`, `rope`, `shibari`, `tentacles`, `restrained` |
| 5 | **Body focus** | Breast emphasis, Ass emphasis, Feet/legwear, Sweat/body fluids | Adjusts body tag emphasis + adds `shiny skin`, `sweat`, `body blush` |
| 6 | **Mental state** | Mind break, Ahegao, Hypnosis, Reluctant arousal | `heart-shaped pupils`, `ahegao`, `empty eyes`, `rolling eyes`, `tongue out` |
| 7 | **Scenario** | Groping, Voyeurism, Caught changing, Forced display | `groping`, `peeking`, `caught`, `covering`, scenario context tags |
| 8 | **Transformation** | Monster girl, Corruption marks, Body modification, Animal features, Tattoo spread | `monster girl`, `body markings`, `corruption`, `animal ears`, `tail`, `tattoo`, `glowing eyes` |
| 9 | **Moral degeneration** | Innocence to corruption, Identity loss, Willing degradation, Broken resistance | Narrative arc pattern — adjusts `/story` escalation. Tags: `heart-shaped pupils`, `empty eyes`, `ahegao`, progressive outfit/expression shifts |
| 10 | **Composition** | 2koma/instant loss, Before/after, Sequential comparison | `2koma` tag, split composition with contrasting states (clothed→nude, confident→broken) |

### Question 3 — Intensity Preference

| Level | Effect |
|-------|--------|
| Subtle | Implied, suggestive — tags barely hint at theme |
| Moderate | Visible but not overwhelming — 2-3 fetish-related tags |
| Maximum | Dominant theme — emphasized tags, multiple state/scenario modifiers |

---

## Round 1 — Hair

Ask via AskUserQuestion:

1. **Hair color** — blonde, brown, black, red, blue, pink, white, silver, purple, green, orange, + "other/multicolored"
2. **Hair length & style** — Length (short / medium / long / very long) + Style (straight, ponytail, twintails, braid, bun, bob cut, hime cut, messy, wavy, curly, + "other")
3. **Bang style** — blunt bangs, swept bangs, side-swept bangs, parted bangs, curtained hair, hair over one eye, no bangs / skip

Cross-reference selections against `tags/appearance.yaml` hair_color, hair_style, and hair_accessories_on_hair subcategories for exact Danbooru tags.

---

## Round 2 — Eyes & Face

1. **Eye color** — blue, red, green, brown, purple, yellow, orange, pink, golden, amber, + "heterochromia" / "other"
2. **Eye shape** — Present with brief personality descriptions:
   - Tareme — gentle, droopy (soft/kind personality)
   - Tsurime — sharp, upward (confident/intense personality)
   - Jitome — half-lidded (bored/cool personality)
   - No preference / skip
3. **Facial features** (multi-select, optional) — fang, mole (ask placement if selected), freckles, glasses, earrings, piercing, lipstick (ask color), beauty mark, sharp teeth, "none"

Cross-reference against `tags/appearance.yaml` eye_color, eye_style, and facial_features subcategories.

---

## Round 3 — Body & Proportions

Questions adapt based on Round 0 content rating.

### Always asked:
- **Build** — slender, petite, curvy, athletic/toned, plump, muscular
- **Height** (optional) — tall, short, average

### Asked at Ecchi+:
- **Chest size** — flat, small, medium, large, huge
- **Lower body emphasis** (multi-select, optional) — long legs, thick thighs, wide hips, narrow waist, "no emphasis"

### Asked at NSFW+:
- **Skin effects** (multi-select, optional) — shiny skin, body blush, sweat, wet skin, "none"

### Fetish-specific follow-ups:
- **Body focus** selected → "Which body areas should be emphasized?" (breasts, ass, legs, navel/midriff, all)
- **Restraint** selected → "What type of restraint?" (rope/shibari, chains, handcuffs, tentacles, ribbons) + "Positioning?" (arms behind back, spread, suspended, tied to object)
- **Transformation** selected → "Which non-human features?" (animal ears type, tail type, horns type, wings type, markings)

Cross-reference against `tags/appearance.yaml` body_type subcategory.

---

## Round 4 — Skin & Extras

1. **Skin tone** — pale, fair, light, tan, dark, olive
2. **Non-human features** (multi-select, optional) — cat ears, fox ears, rabbit ears, dog ears, horns (demon/dragon/oni/curved), tail (cat/fox/demon/dragon), wings (angel/demon/fairy), halo, "none"
3. **Body markings** (multi-select, optional) — tattoo (ask placement: back, arm, shoulder, leg, chest), scar (ask placement), body markings, stitches, "none"

Cross-reference against `tags/appearance.yaml` skin, other_features subcategories.

---

## Character Appearance Summary

After all rounds, present for confirmation before moving to outfit:

```markdown
### Character Profile
| Category | Tags | Weight |
|----------|------|--------|
| Intent | [rating] — [fetish directions] | — |
| Intensity | [level] | — |
| Hair | {[color]}, {[style]}, [bangs] | {}, {}, — |
| Eyes | {[color]}, [shape] | {}, — |
| Body | [build], [chest], [emphasis] | varies |
| Skin | [tone], [effects] | — |
| Face | [features] | — |
| Extras | [non-human], [markings] | — |
```

Auto-weighting applied per `references/auto-weighting.md`:
- Hair color and eye color get `{}` single emphasis
- Body tags stay unweighted unless fetish-emphasized
- Non-human features stay unweighted unless they're the defining visual element

Then ask: **"Does this look right? Want to adjust anything before we move to outfit?"**

---

## Flow Rules

1. Each round uses AskUserQuestion with 2-3 questions max
2. User can respond "skip" or "default" on any round — sensible defaults filled and noted as suggestions
3. Default assumptions when skipped:
   - Round 0: NSFW Soft, no specific fetish, Moderate intensity
   - Round 1: Black hair, long, straight, side-swept bangs
   - Round 2: Brown eyes, tareme, no facial features
   - Round 3: Slender, medium breasts, average height
   - Round 4: Fair skin, no extras
4. Total rounds: 5 (Round 0-4), completable in ~3 minutes
5. Intent & fetish selections persist beyond appearance — they inform outfit suggestions, clothing states, scenario context, and `/story` escalation pacing
6. If user changes their mind mid-interview, allow going back to any previous round

## Cascade Summary

```
Round 0 (Intent)
  │
  ├─► Round 3: Controls which body questions appear
  ├─► Outfit building: Controls which states/scenarios are suggested
  ├─► /story: Controls escalation pacing and scene suggestions
  └─► Auto-weighting: Controls which fetish tags get emphasis
```
