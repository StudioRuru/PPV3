# Auto-Weighting Rules — V4.5 Numeric Emphasis

When building prompts, apply emphasis automatically based on this decision tree.

**V4.5 uses numeric emphasis `weight::tag::`** — this is the single convention this tool emits.
The old `{{}}`/`{}`/`[]` bracket math is V3-era (only ~1.05× per bracket level — visually
flat) and is **deprecated**. See the conversion table below for reading legacy prompts.

## The numeric tiers

| Tier | Syntax | Use for | Cap per segment |
|------|--------|---------|-----------------|
| **Defining** | `1.3::tag::` | the single most defining visual element of the segment | **1–2** (ideally 1) |
| **Key** | `1.15::tag::` | character-defining traits / key garments | a few |
| **Default** | `tag` (no weight) | everything else — most tags | — |
| **De-emphasis** | `0.9::tag::` | present-but-subtle background/ambient | as needed |
| **Removal** | `-1::concept::` | force a concept out (see negative-prompts.md) | as needed |

**Overall rule (user preference): keep weighted tags few — aim for ≤3 weighted tags per
segment, and never exceed 2 `1.3::` + 6 `1.15::`.** Most tags should be unweighted.
Over-emphasis dilutes generation; one clear focal weight beats many small nudges.

## Tier 1 — Defining `1.3::tag::`
Apply to the **single most defining visual element** of the prompt:
- The primary outfit concept when it's the focal point (e.g., `1.3::gothic lolita::`, `1.3::wedding dress::`, `1.3::school uniform::`)
- A critical artist tag when exact style match is essential

**Rule**: Only 1–2 tags should ever get defining emphasis. More dilutes the effect.

## Tier 2 — Key `1.15::tag::`
Apply to **character-defining traits and key outfit pieces**:
- Primary hair color: `1.15::blonde hair::`
- Primary hair style: `1.15::twintails::`
- Primary eye color: `1.15::blue eyes::`
- Main outfit garment (the focal top/bottom or main dress): `1.15::pleated skirt::`
- Important pose if it's central to composition: `1.15::dynamic pose::`
- Artist tag (when not the defining `1.3::` element)

**Rule**: Keep these few — prefer ≤2 alongside the single defining tag.

## Tier 3 — No Weighting (default)
Apply to **standard supporting elements**:
- Secondary clothing items (layering pieces, undershirts)
- Standard accessories (hairband, bracelet, etc.)
- Common modifiers: `smile`, `looking at viewer`, `standing`
- Secondary hair details: `bangs`, `sidelocks`
- Material/pattern tags: `lace`, `plaid`
- Setting details: `classroom`, `indoors`

**Rule**: Most tags in a prompt should be unweighted.

## Tier 4 — De-emphasis `0.9::tag::`
Apply to **background/ambient details that should be present but subtle**:
- Background setting when character is the focus: `0.9::garden::`, `0.9::cityscape::`
- Secondary artist when mixing styles: `0.7::artist:secondary_name::`
- Subtle atmospheric effects: `0.9::rain::`, `0.9::fog::`

(The year tag — `year 2025` — is normally left unweighted.)

## Tier 5 — Targeted removal `-1::concept::`
V4.5-exclusive negative emphasis, in the positive prompt:
- `-1::monochrome::` to force color (concept inversion)
- `-1::simple background::` to force detailed backgrounds
- Stronger removal with larger magnitude: `-2::hat::`

## Decision Flowchart

```
Is this THE defining visual element? ──yes──▶ 1.3::tag::
                │ no
Is this a primary trait / key garment? ──yes──▶ 1.15::tag::
                │ no
Is this a standard supporting detail? ──yes──▶ tag (no weight)
                │ no
Is this background / ambient / secondary? ──yes──▶ 0.9::tag::
                │ no
Must a concept be forced OUT? ──yes──▶ -1::concept::
```

## Bracket → numeric conversion (for reading legacy prompts)

| Legacy bracket | Numeric equivalent |
|----------------|--------------------|
| `{tag}` | `1.15::tag::` |
| `{{tag}}` | `1.3::tag::` |
| `{{{tag}}}` | `1.4::tag::` |
| `[tag]` | `0.9::tag::` |
| `[[tag]]` | `0.8::tag::` |

A bare `::` both ends a numeric run **and closes any open `{`/`[`** — so mixed or legacy
prompts can be migrated incrementally without breakage. When loading saved outfits/arcs that
still use brackets, read them via this table; emit numeric going forward.

## Token Budget Awareness

V4.5 has a ~512 T5 token limit across base + all character prompts. Every tag costs tokens.

**Target counts:**
- Base prompt: 10–12 tags *(note: top community images often run ~28 base tags — see `gallery-insights.md`; this target favors coherence, but longer is not a hard error)*
- Character prompt: ≤28 tags (leaner is more coherent; identity/clothing render better when not crowded)
- Clothing-state tags: ≤5 per segment
- Weighted tags: aim ≤3 per segment; hard cap 2 `1.3::` + 6 `1.15::` (base and character counted separately)

**Reduce redundancy:**
- `completely nude` implies `bare shoulders`, `bare arms`, `bare back` — don't add those separately
- `body blush` implies `blushing` — don't add both
- **When a garment has a state, drop the pristine-garment tag**: `open shirt` ⇒ drop `white shirt`; `torn skirt` ⇒ drop `plaid skirt`. Stacking pristine + state versions of the same garment makes the model unsure what the garment is (mushy clothing).
- Use compound Danbooru tags: `blue pleated skirt` (1 concept) > `blue` + `pleated` + `skirt` (3 tags)

## Examples

**Office lady portrait (optimized — 26 character tags):**
```
masterpiece, very aesthetic, artist:ciloranko, 1girl, cowboy shot, 0.9::office::, 0.9::indoors::, 0.9::sunlight::, no text | girl, 1.15::black hair::, ponytail, 1.15::green eyes::, tsurime, slender, fair skin, 1.3::pencil skirt::, white shirt, blazer, black pantyhose, high heels, glasses, necktie, standing, hand on hip, looking at viewer, smile
```

**School uniform full body (optimized — 24 character tags):**
```
masterpiece, very aesthetic, year 2025, artist:kantoku, 1girl, full body, 0.9::school rooftop::, 0.9::outdoors::, 0.9::blue sky::, no text | girl, 1.15::brown hair::, long hair, side-swept bangs, 1.15::blue eyes::, 1.3::school uniform::, serafuku, pleated skirt, sailor collar, black thighhighs, loafers, school bag, standing, looking at viewer, smile
```
