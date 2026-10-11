# NovelAI Diffusion V4.5 Full — Prompt Syntax Reference

## Tag Format
- Comma-separated Danbooru-style tags: `1girl, blonde hair, school uniform, smile`
- Tags are case-insensitive but lowercase is conventional
- Spaces within tags are fine: `long hair` not `long_hair`
- Earlier tags carry slightly more weight, but V4.5 is flexible about ordering

## Emphasis / Weighting

### Numeric Syntax (V4.5 native — this is what the tool emits)
- Format: `weight::text::`
- Strengthen: `1.3::rain, night::` (1.3× emphasis on rain and night)
- Weaken: `0.9::coat::` (reduced emphasis on coat)
- A bare `::` ends a numeric run **and closes any open `{`/`[`** — so legacy bracket prompts can be migrated incrementally.
- **Standard tiers** (see `auto-weighting.md`): defining `1.3::tag::` (max 1–2), key `1.15::tag::` (a few), de-emphasis `0.9::tag::`. Keep weighted tags few — most tags unweighted.
- **Negative emphasis** (V4.5 exclusive): `-1::hat::` removes hats from output
  - Useful for targeted concept removal without cluttering the negative prompt
  - Higher magnitude for stronger removal: `-3::hat::` is more aggressive
  - **Concept inversion**: `-1::monochrome::` adds color; `-2.5::flat color::` increases detail

### Legacy bracket syntax (deprecated — read-only)
Old saves may use `{}`/`[]` (V3-era, ~1.05× per level — too flat to be useful on V4.5). Read them via this table; **do not emit brackets in new prompts**:

| Legacy | Numeric |
|--------|---------|
| `{tag}` / `{{tag}}` / `{{{tag}}}` | `1.15::` / `1.3::` / `1.4::` |
| `[tag]` / `[[tag]]` | `0.9::` / `0.8::` |

## Quality Tags
V4.5 Full auto-appends (when "Add Quality Tags" is enabled):
```
location, very aesthetic, masterpiece, no text
```

### Aesthetic Tag Hierarchy (use in positive prompt)
- `masterpiece` — Top tier (V4.5-specific, most important quality tag)
- `very aesthetic` — High quality
- `aesthetic` — Good quality

> **Community-observed (see `gallery-insights.md`):** top-rated images stack more than this —
> the common real-world quality block is `masterpiece, best quality, very aesthetic, absurdres`,
> frequently plus `amazing quality` and a `year 20XX` tag.

### Anti-Quality Tags (use in negative prompt)
- `displeasing` — Low quality
- `very displeasing` — Very low quality

## Artist Tags
- Prefix: `artist:name`
- Examples: `artist:ciloranko`, `artist:anmi`, `artist:ke-ta`
- Combine 2-3 artists for style mixing
- Weight secondary artists numerically if one should dominate:
  ```
  artist:ciloranko, 0.7::artist:anmi::
  ```

### Why artist tags matter (incl. NSFW quality)
Artist tags are not just stylistic flavor — on V4.5 they materially improve output quality,
including anatomy and NSFW coherence. A verified Danbooru artist tag anchors the model to a
specific, well-represented region of its training distribution where bodies, hands, and
explicit content are rendered consistently; without one the model averages across everything
and drifts. **Always include at least one artist tag.** Two caveats:
- Use only **verified Danbooru artist tags**. Many legacy Stable-Diffusion artist names do
  not work on NovelAI and silently do nothing.
- V4.5 replicates artists far better than earlier models, so a single strong artist often
  beats a muddy 3-way mix. Mix deliberately, weighting the secondary down (`0.7::artist:x::`).

> **Community-observed caveat (see `gallery-insights.md`):** among the top 50 SFW `1girl`
> images, **0 used an explicit `artist:` tag** — they reached high aesthetic quality with the
> quality-tag stack, `year 20XX`, and `(medium)` style tags (e.g. `::oil painting (medium)::`)
> instead. The rule above holds for **style-locking and NSFW anatomy coherence**, but for
> general SFW aesthetics a strong quality/medium/year stack is sufficient on its own — don't
> treat a missing artist tag as an error.

## Character Tags
- Use Danbooru character names directly: `hatsune miku`, `rem (re:zero)`
- Character tags auto-associate canonical appearance, clothing, and colors
- Override defaults by adding explicit appearance tags after the character name

## Multi-Character (V4.5 feature)
- Syntax: `base prompt | character 1 prompt | character 2 prompt`
- Up to 6 characters per image
- Subject count goes in base prompt only: `2girls` in base, `girl` in individual
- Use action tags for interaction control:
  - `source#kiss` — character performing the action
  - `target#kiss` — character receiving the action
  - `mutual#hug` — both characters doing the action

## Text on Images
- Include tags: `text, english text`
- Add `Text: your text here` at the **very end** of the prompt
- CRITICAL: Nothing should come after `Text:` or trailing tags render as text in image

## Special Tags
- `location` — Indicates a location without specifying indoor/outdoor
- `no text` — Suppresses unwanted text in the image
- `year 2025` — Steers toward more recent art styles (use the current/recent year; usually left unweighted)
- `1girl` / `1boy` — Character count (always include)

## Recommended Tag Order

**Base prompt** (earlier = stronger influence in V4.5):
1. Quality tags: `masterpiece, very aesthetic`
2. Year tag: `year 2025`
3. Artist tags: `artist:name`
4. Character count: `1girl`
5. Framing: `cowboy shot`, `full body`
6. Camera angle: `from below`, `dutch angle`
7. Scene effects: `wind`, `motion blur`
8. Setting: `0.9::classroom::`, `0.9::indoors::`
9. Closing: `no text`

**Character prompt** (per character):
1. Character identifier: `girl` (NOT `1girl` — count stays in base)
2. Character name: `daiwa scarlet (umamusume)`
3. Hair: color → style → length → extras
4. Eyes: color → style
5. Body/skin
6. Outfit: top → bottom → footwear → legwear → accessories → materials → state
   (when a garment has a state, keep the state tag and drop the pristine-garment tag)
7. Pose and expression
8. Negative emphasis: `-1::concept::`

---

## Precise Reference (V4.5 Only)

The V4.5 reference feature. Upload a reference image to reproduce a **character**,
a **style**, or **both** across generations. (On V4.5 this supersedes the older
standalone "Character Reference" — character reference is now the Character
sub-type of Precise Reference.)

### Reference types
- **Character Reference** — reproduce the character's face, hair, body, colors.
  Multiple character references currently **blend into one** character, not separate ones.
- **Style Reference** — reproduce the overall art style (rendering, palette). This
  is the tool for recreating an art style from pixels.
- **Character & Style** — both from one or more references.

### Two sliders (this is the part people get wrong)
Precise Reference has **two independent sliders**, not one — click a number to
type **negative** values (useful to push away an ugly/unwanted trait):

| Slider | Low | High |
|--------|-----|------|
| **Strength** | Reference lightly influences the output | Strongly adheres to style, palette, and visual traits — but poses/expressions/angles start mirroring the reference |
| **Fidelity** | Reference is easily overridden by the prompt (flexible) | Reference is enforced aggressively, hard to override by prompting |

- Style, not composition: raise **Strength** for palette/rendering, keep
  **Fidelity** moderate so the prompt still drives pose and content.

### Best reference image
- **Clean illustrations reproduce best** — painterly/sketchy art and real photos reproduce worse.
- **High resolution**: 1024×1536, 1472×1472, or 1536×1024; subject large on canvas.
- **Face accuracy**: paste a zoomed face crop into a corner of the reference.
- **Character sheets** help: tag `multiple views`, `turnaround`, `reference sheet`, `character sheet`, `cropped shoulders`, `expressions`.

### Costs & compatibility
- ~5 Anlas per generation (scales with number of references).
- **Incompatible with Vibe Transfer** — choose one or the other.

### Precise Reference + prompts (story arcs)
With a Character Reference active you can lean on it and reduce appearance tags:
- **Keep**: outfit tags, pose, expression (these change per scene).
- **Reduce/remove**: hair color/style, eye color, body type (the reference handles these).
- **Override**: to change something the reference would enforce, add the tag explicitly with emphasis.
- Arc workflow: generate Scene 1 with full character tags → use that output as the Character Reference for later scenes.

See `../../identify/references/style-recreation.md` for the full art-style
recreation decision tree (including recovering an exact recipe from a NAI PNG).

---

## Vibe Transfer

Transfers overall mood, color palette, and composition from a reference image.
Looser than Precise Reference — reach for it when you want a *vibe* rather than a
strict style lock, or need to blend several references.

### Settings
| Parameter | Recommendation |
|-----------|---------------|
| Reference Strength | How hard it emulates the reference. Keep the **sum of all vibes ≤ 1.0**; use the **Normalize Reference Strengths** toggle (V4+) to auto-balance. Too high → it ignores the text prompt. |
| Information Extracted | Start at default. **Lowering it drops high-frequency detail (textures) first**, keeping composition — borrow layout/mood without forcing the reference's textures. |

### Best Practices
- Good for consistent lighting, mood, and color palette across scenes.
- **Compatible with prompts** — vibes layer on top of tag-based generation.
- **NOT compatible with Precise Reference** — pick one.
- Up to **16 vibes** (quality degrades past a handful).
- **Costs**: 2 Anlas to encode a vibe (re-encoding after changing Information Extracted costs 2 again). Export/reuse as `.naiv4vibe` to skip the fee.

---

## Samplers & Settings for Style Recreation

NAI officially recommends **Euler Ancestral** and **DPM++ 2M**. The distinction
that matters when reproducing a look:

| Goal | Sampler | Why |
|------|---------|-----|
| Reproduce an **exact** image, or keep a stable base to iterate on | **k_euler** / **k_dpmpp_2m** + **fixed seed** | Non-ancestral samplers are **deterministic** — they converge, so a fixed seed gives the same image and lets a reference dominate without drift. |
| Fresh, varied content merely *in* a style | **k_euler_ancestral** | Ancestral re-injects noise each step → never fully converges → more variation/texture, but **not reproducible** even at a fixed seed. |
| High resolution | any **SMEA / SMEA DYN** variant | Better coherence at large sizes; guidance can go higher before breaking. |

Baseline: **28 steps**, **guidance 5–6** (higher = more literal to prompt +
reference; lower = more creative). When reproducing a recovered NAI recipe, match
its sampler/steps/scale/seed exactly rather than these defaults.

> **Community-observed (see `gallery-insights.md`):** top `1girl` images overwhelmingly use
> `k_euler_ancestral` (84%), 28 steps (70%), guidance 5, **noise `karras` (92%)**, and
> **cfg_rescale `0` (60%)** — the last two aren't captured by this table's fresh-vs-exact split.

---

## Token Budget

V4.5 uses ~512 T5 tokens across base + all character prompts combined.

### Impact
- Longer prompts = less stable generations, more visual artifacts
- Redundant tags waste budget without improving output
- Heavy emphasis costs more attention than simple tags

### Optimization Rules
- Use compound Danbooru tags: `blue pleated skirt` > `blue` + `pleated` + `skirt`
- Don't repeat implied concepts: `completely nude` already implies all `bare_` tags
- When a garment has a state, drop the pristine-garment tag (`open shirt` ⇒ drop `white shirt`)
- Target: 10-12 base tags, ≤28 character tags, ≤5 clothing-state tags
- Weighted tags: aim ≤3 per segment; hard cap 2 `1.3::` + 6 `1.15::`
- Always use numeric `weight::text::` — never bracket nesting

> **Community-observed (see `gallery-insights.md`):** top images actually run **longer** base
> prompts than the 10–12 target (median ~28, up to 78 base tags). The "longer = more artifacts"
> caution is a real *risk*, not a hard ceiling — rich descriptions are common in top results.
