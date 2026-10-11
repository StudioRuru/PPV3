# Output Format — V2

Always produce output in two phases: structured breakdown first, then final combined prompt.

---

## Phase 1: Structured Breakdown

Present this for user review before generating the final prompt. Use markdown tables.

```markdown
## Prompt Breakdown

### Character
| Category | Tags | Weight |
|----------|------|--------|
| Hair | blonde hair, long hair, side-swept bangs | 1.15, —, — |
| Eyes | blue eyes, tsurime | 1.15, — |
| Body | slender | — |
| Skin | fair skin | — |

### Outfit
| Category | Tags | Weight |
|----------|------|--------|
| Top | white shirt, blazer | 1.3, — |
| Bottom | pleated skirt | — |
| Footwear | loafers | — |
| Legwear | black thighhighs | — |
| Accessories | necktie, hairband | —, — |
| Material | — | — |
| State | — | — |

### Composition
| Category | Tags |
|----------|------|
| Pose | standing, hand on hip |
| Expression | smile, looking at viewer |
| Framing | cowboy shot |
| Setting | [classroom], [indoors], [sunlight] |
| Scenario | — |

### Style
| Category | Tags |
|----------|------|
| Artist | artist:ciloranko |
| Quality | masterpiece, very aesthetic |
| Year | year 2025 |

### Suggested Artists
| Artist | Why |
|--------|-----|
| artist:ciloranko | Clean rendering, vivid colors — ideal for outfit showcase |
| artist:kantoku | Soft, delicate — good for school/casual themes |

### Generation Settings
| Setting | Value |
|---------|-------|
| Resolution | 832x1216 (portrait) |
| Guidance Scale | 5 |
| Sampler | Euler |
| Steps | 28 |
```

### Weight Legend (V4.5 numeric — see `auto-weighting.md`)
- `1.3` = `1.3::tag::` defining element (max 1–2 per segment)
- `1.15` = `1.15::tag::` key element (keep few)
- — = no weighting (most tags)
- `0.9` = `0.9::tag::` de-emphasized
- `-1` = `-1::tag::` targeted removal

### Creative Partner Suggestions
After presenting the breakdown, proactively offer 2-3 suggestions:
- Outfit modifications that could enhance the theme
- Pose alternatives that create more dynamic compositions
- Thematic enhancements (clothing states, atmosphere, scenario context)
- Unexpected creative twists that push the concept further

Then ask: **"Would you like to adjust anything, try any of my suggestions, or generate the final prompt?"**

---

## Phase 2: Final Combined Prompt

After user approves (or requests changes), output the copy-ready prompt as **separate field
blocks** — these map directly to NAI's input fields (Base prompt box, each Character prompt
box, Undesired Content box). This is the primary output; copy each block into its own field.

```markdown
## Final Prompt

**Base:** (→ NAI base prompt field)
```
masterpiece, very aesthetic, year 2025, artist:ciloranko, 1girl, cowboy shot, 0.9::classroom::, 0.9::indoors::, 0.9::sunlight::, no text
```

**Character 1:** (→ NAI "+ Add Character" box)
```
girl, 1.15::blonde hair::, long hair, side-swept bangs, 1.15::blue eyes::, tsurime, slender, fair skin, 1.3::white shirt::, blazer, pleated skirt, necktie, hairband, black thighhighs, loafers, standing, hand on hip, smile, looking at viewer
```

**Undesired Content:** (→ NAI undesired content field)
```
worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad hands, missing fingers, extra fingers, extra digit, fewer digits, text, error, jpeg artifacts, watermark, username, blurry, signature, cropped, multiple girls
```

**Settings:** 832x1216 | Guidance 5 | Euler | 28 steps

> **Combined (legacy `|` form — only if you are NOT using character prompt boxes):**
> NAI **disables the `|` syntax once any character box exists**, so this is for the single-box
> workflow only. Prefer the separate blocks above.
> ```
> masterpiece, very aesthetic, year 2025, artist:ciloranko, 1girl, cowboy shot, 0.9::classroom::, 0.9::indoors::, 0.9::sunlight::, no text | girl, 1.15::blonde hair::, long hair, side-swept bangs, 1.15::blue eyes::, tsurime, slender, fair skin, 1.3::white shirt::, blazer, pleated skirt, necktie, hairband, black thighhighs, loafers, standing, hand on hip, smile, looking at viewer
> ```
```

---

## Tag Ordering — Base + Character Fields

Author the **base** and each **character** as separate segments. Copy them into NAI's
separate fields (base box + one "+ Add Character" box per character). The `|` combined form
is only for the single-box workflow (NAI disables `|` once a character box exists).

**Multi-character scenes (2+ figures):**
- Count tag (`2girls`) goes in the **base only**; each character box opens with `girl`/`boy`.
- Use **one character box per figure**, plus the **5×5 position grid** to place them (don't rely on text like "on the left").
- Interaction uses action tags: `source#kiss` (performer), `target#kiss` (receiver), `mutual#hug` (both).
- Block trait bleed with **per-character Undesired Content** (e.g. Character A's box blocks `red hair` if only B has it).

### Base Prompt Order (scene, composition, global)
1. **Quality tags**: masterpiece, very aesthetic
2. **Year tag**: year 2025
3. **Artist tag(s)**: artist:name
4. **Character count**: 1girl / 1boy / 2girls (count ONLY in base)
5. **Framing**: full body, cowboy shot, portrait, etc.
6. **Camera angle**: from below, dutch angle, from above, etc.
7. **Scene effects**: motion blur, motion lines, wind, particles
8. **Setting**: location, lighting, time of day
9. **Closing tags**: no text

### Character Prompt Order (per character)
1. **Character identifier**: girl / boy (NOT 1girl — count stays in base)
2. **Identity**: character name tag
3. **Hair**: color → style → length → extras
4. **Eyes**: color → style → state
5. **Body**: type → features
6. **Skin**: tone → effects
7. **Facial**: makeup, marks, blush
8. **Outfit — Top/Core**: main garment, layers, state (when stated, drop the pristine-garment tag)
9. **Outfit — Bottom**: skirt, pants, shorts
10. **Outfit — Footwear**: shoes, boots, heels
11. **Outfit — Legwear**: thighhighs, socks, garters
12. **Outfit — Accessories**: head → neck → hands → other
13. **Outfit — Materials**: fabric, pattern
14. **Outfit — State**: clothes pull, torn clothes, wardrobe malfunction
15. **Pose**: stance, hand position, action
16. **Expression**: face, emotion, gaze direction
17. **Negative emphasis tags**: any -weight::concept:: entries

## Token Budget Awareness

V4.5 has ~512 T5 tokens across base + all character prompts combined. Monitor token usage:

**Target tag counts:**
- Base prompt: 10-12 tags
- Character prompt: ≤28 tags per character (leaner renders more coherently)
- Clothing-state tags: ≤5 per segment
- Weighted tags: aim ≤3 per segment; hard cap 2 `1.3::` + 6 `1.15::`

**In the structured breakdown, flag:**
- Duplicate tags — **no tag may appear twice within a segment** (base or character). Collapse repeats (e.g. `1.3::shiny skin::` listed twice → keep one).
- Redundant tags (e.g., `blushing` + `blush` + `body blush` — keep only one)
- Tags implied by other tags (e.g., `completely nude` already implies `bare shoulders`, `bare arms`)
- **Pristine + state of the same garment** (`open shirt` + `white shirt` → keep only `open shirt`)
- Separate tags that could be compound (e.g., `blue` + `pleated` + `skirt` → `blue pleated skirt`)

**Emphasis cap (single source of truth — matches `auto-weighting.md`):** aim ≤3 weighted tags per segment; hard cap **2 `1.3::` + 6 `1.15::`** per segment. Over-emphasis dilutes generation; demote excess to unweighted.

---

## Reference-Based Story Arc Workflow (character consistency)

For multi-scene arcs, anchor the character with a reference so identity doesn't drift. Two
options — **prefer Precise Reference when the character has a beauty shot**:

**Option A — Precise Reference (strongest lock; +5 Anlas/gen):**
1. If the character was built with `/sheet` and has a `reference_sheet.beauty_shot`, generate that beauty shot once and upload it as the **Precise Reference** input.
2. Use it across **all** scenes (including Scene 1) at fidelity 0.65–0.80 (0.80 = tighter identity, 0.65 = more pose freedom).
3. A purpose-built clean beauty shot is a better anchor than chaining CRef off Scene 1's output (which inherits Scene 1's flaws and drifts).
4. Precise Reference is **incompatible with Vibe Transfer** — pick one.

**Option B — Character Reference (CRef) from Scene 1 output (free):**
1. **Scene 1**: include full character appearance tags in the character prompt.
2. **Scene 2+**: use Scene 1's output as CRef (fidelity 0.65–0.8).
3. With CRef active, reduce appearance tags to only what *changes* — hair/eye colors can be dropped since CRef handles them (~30% fewer character tags per scene).

**Reference prompt template (Scene 2+, either option):**
```
Base: masterpiece, very aesthetic, artist:name, 1girl, framing, 0.9::setting::, no text
Character: girl, [only changed outfit/pose/expression tags — the reference handles appearance]
```

Note in breakdown: "CRef recommended — appearance tags reduced since reference image handles character consistency."

---

## Handling Modifications

If the user requests changes after seeing the breakdown:
1. Update only the changed sections
2. Show the updated breakdown section (not the entire thing again)
3. Then regenerate the final prompt with changes applied
