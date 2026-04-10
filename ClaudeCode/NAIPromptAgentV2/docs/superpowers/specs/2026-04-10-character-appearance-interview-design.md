# Character Appearance Interview Protocol — Design Spec

**Date**: 2026-04-10
**Status**: Approved
**Scope**: `/prompt` and `/story` skills

## Problem

The current character-first build flow in both `/prompt` and `/story` asks a single broad question about appearance ("What hair color and style? Eye color? Any distinguishing features?"). This is too shallow — body proportions, NSFW intent, and fetish direction are never explicitly asked about, forcing the user to manually correct or add details after the first draft. The result is wasted rounds and prompts that don't match the user's mental image.

## Solution

A structured, multi-round **Character Appearance Interview** that replaces the current single-question approach. Defined as a shared reference doc (`references/appearance-interview.md`) that both skills import. Five rounds, each with 2-3 direct questions via AskUserQuestion.

## When It Triggers

- `/prompt` with no input, choosing "Build from character" or "Build from scenario"
- `/prompt` with partial input missing appearance details
- `/story` Phase 1 Opening Interview, Round 1 (replaces "Describe their look")
- **Skipped** when loading a saved character profile or using a known game character tag (Danbooru character name provided)
- **Skipped** when user provides reference images — use `/investigate` to extract tags, then present summary for confirmation

---

## Interview Rounds

### Round 0 — Intent & Tone

Set the creative direction before any appearance questions. This cascades into all subsequent rounds.

**Question 1 — Content Rating:**

| Rating | Description | Effect on Later Rounds |
|--------|-------------|----------------------|
| SFW | Clean illustration, no suggestive content | Body round skips chest emphasis, skin effects. States/scenarios limited to non-suggestive |
| Ecchi | Suggestive but not explicit — panty shots, cleavage, clothing damage | Body round includes chest/hip options. States include clothing damage, strap slip |
| NSFW Soft | Nudity, exposure, mild sexual content | Full body detail questions. States include all clothing removal |
| NSFW Hard | Explicit sexual content, full nudity, graphic scenarios | Full body + explicit tags unlocked. All states/scenarios available |

**Question 2 — Fetish Direction (if Ecchi or higher):**
Multi-select from 10 categories:

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
| 9 | **Moral degeneration** | Innocence to corruption, Identity loss, Willing degradation, Broken resistance | Narrative arc pattern — adjusts `/story` escalation structure. Tags: `heart-shaped pupils`, `empty eyes`, `ahegao`, progressive outfit/expression shifts |
| 10 | **Composition** | 2koma/instant loss, Before/after, Sequential comparison | `2koma` tag, split composition with contrasting states (clothed→nude, confident→broken) |

**Question 3 — Intensity Preference:**

| Level | Effect |
|-------|--------|
| Subtle | Implied, suggestive — tags barely hint at theme |
| Moderate | Visible but not overwhelming — 2-3 fetish-related tags |
| Maximum | Dominant theme — emphasized tags, multiple state/scenario modifiers |

### Round 1 — Hair

Ask via AskUserQuestion:
- **Hair color** — Options from `appearance.yaml` hair_color subcategory (blonde, brown, black, red, blue, pink, white, silver, + "other")
- **Hair length & style** — Length (short/medium/long/very long) + Style (straight, ponytail, twintails, braid, bun, bob, hime cut, messy, wavy, curly, + "other")
- **Bang style** — Blunt bangs, swept bangs, side-swept bangs, parted bangs, curtained hair, hair over one eye, no bangs

### Round 2 — Eyes & Face

- **Eye color** — Options from `appearance.yaml` eye_color subcategory
- **Eye shape** — With brief descriptions:
  - Tareme (gentle, droopy — soft/kind personality)
  - Tsurime (sharp, upward — confident/intense personality)
  - Jitome (half-lidded — bored/cool personality)
  - Default/no preference
- **Facial features** (multi-select, optional) — Fang, mole (+ placement), freckles, glasses, earrings, piercing, makeup (lipstick color), sharp teeth, beauty mark, "none"

### Round 3 — Body & Proportions

Questions adapt based on Round 0 content rating:

**Always asked:**
- **Build** — Slender, petite, curvy, athletic/toned, plump, muscular
- **Height** — Tall, short, average (optional)

**Asked at Ecchi+:**
- **Chest size** — Flat, small, medium, large, huge
- **Lower body emphasis** (multi-select) — Long legs, thick thighs, wide hips, narrow waist, "no emphasis"

**Asked at NSFW+:**
- **Skin effects** (multi-select) — Shiny skin, body blush, sweat, wet skin, "none"

**Fetish-specific follow-ups:**
- If "Body focus" selected → ask which body areas to emphasize
- If "Restraint" selected → ask about restraint type and positioning
- If "Transformation" selected → ask about which non-human features

### Round 4 — Skin & Extras

- **Skin tone** — Pale, fair, light, tan, dark, olive
- **Non-human features** (multi-select, optional) — Cat ears, fox ears, rabbit ears, horns (type), tail (type), wings (type), halo, "none"
- **Body markings** (multi-select, optional) — Tattoo (+ placement), scar (+ placement), body markings, stitches, "none"

---

## Output: Character Appearance Summary

After all rounds, present a summary table for confirmation:

```markdown
### Character Profile
| Category | Tags | Weight |
|----------|------|--------|
| Intent | NSFW Soft — exhibitionism, humiliation | — |
| Intensity | Maximum | — |
| Hair | {blonde hair}, {long hair}, side-swept bangs | {}, {}, — |
| Eyes | {blue eyes}, tsurime | {}, — |
| Body | slender, medium breasts, long legs, shiny skin | —, —, —, — |
| Skin | fair skin, body blush | —, — |
| Face | fang | — |
| Extras | — | — |
```

Then ask: "Does this look right? Want to adjust anything before we move to outfit?"

---

## Integration Points

### `/prompt` SKILL.md Changes

**Character-First Flow** — Replace step 1:
```
Old:
1. Ask about core appearance: "What hair color and style? Eye color? Any distinguishing features?"

New:
1. Run the Character Appearance Interview (see references/appearance-interview.md)
   - Round 0: Intent & Tone
   - Round 1: Hair
   - Round 2: Eyes & Face
   - Round 3: Body & Proportions (adapts to Round 0)
   - Round 4: Skin & Extras
   - Present Character Appearance Summary for confirmation
```

**Scenario-First Flow** — After establishing the scene, run the interview to build the character for it.

**With reference images** — Skip the interview. Use `/investigate` to extract tags, present summary, ask for confirmation.

### `/story` SKILL.md Changes

**Phase 1 Opening Interview** — Replace Round 1:
```
Old:
Round 1: Character & Setting
- "Who is the main character? Describe their look, or load a saved character."

New:
Round 1: Character
- "Who is the main character?" (name / concept / load saved)
- If new character: Run Character Appearance Interview (Rounds 0-4)
- If loaded: Present saved profile, ask for modifications

Round 2: Setting (unchanged)
- "Where does the story take place?"
- "What time of day? Atmosphere?"
```

The Intent & Tone from Round 0 also informs:
- Escalation pacing suggestions
- Scene transition ideas
- Which clothing states and scenarios to suggest per scene
- How aggressively to push creative suggestions

---

## Flow Rules

1. Each round uses AskUserQuestion with 2-3 questions max
2. User can respond "skip" or "default" on any round — sensible defaults filled and noted
3. Known game characters (Danbooru name provided) skip the interview — canonical appearance loaded automatically
4. Reference images skip the interview — `/investigate` extracts, user confirms
5. Total rounds: 5 (Round 0-4), completable in ~3 minutes of back-and-forth
6. The intent/fetish selections persist into outfit and scene building — they're not just for appearance

## Files to Create/Modify

1. **Create**: `.claude/skills/prompt/references/appearance-interview.md` — The shared protocol doc
2. **Modify**: `.claude/skills/prompt/SKILL.md` — Update Character-First and Scenario-First flows
3. **Modify**: `.claude/skills/story/SKILL.md` — Update Phase 1 Opening Interview

## Verification

- Run `/prompt` with no input, select "Build from character" → verify all 5 rounds execute in order
- Run `/story` with a new character concept → verify the interview runs before setting questions
- Run `/prompt` with a known character name → verify interview is skipped
- Test "skip" on Round 3 → verify sensible body defaults are applied
- Test NSFW Hard + Moral degeneration → verify body round asks full detail questions and story escalation adapts
