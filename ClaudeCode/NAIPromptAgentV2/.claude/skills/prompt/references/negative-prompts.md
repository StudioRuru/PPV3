# Negative Prompt Strategy

## Default Negative (always include)

```
worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad hands, missing fingers, extra fingers, extra digit, fewer digits, text, error, jpeg artifacts, watermark, username, blurry, signature, cropped
```

> **Community-extended block (optional add-on — see `gallery-insights.md`):** top gallery
> images commonly append photo/scan/print cleanup tags on top of the default:
> `scan artifacts, film grain, chromatic aberration, dithering, halftone, screentone, negative space, logo, too many watermarks, blank page, unfinished, multiple views`.
> Offer these as an extra cleanup layer; the block above remains the baseline.

## Situational Additions

Add these to the negative prompt based on what the user is building:

| Situation | Add to Negative | Why |
|-----------|----------------|-----|
| Full body shot | `bad feet, missing shoes` | V4.5 can struggle with feet |
| Single character | `multiple girls, multiple boys, crowd` | Prevent extra characters |
| Any single coherent image | `multiple views, comic, panel, 2koma, 4koma, split screen` | Prevent sheet/comic/panel layouts — see "No-panel doctrine" below |
| Detailed face / portrait | `out of focus` | Keep face sharp |
| Outfit showcase | `holding, carrying` | Prevent unwanted held objects |
| Indoor setting | `outdoors, nature` | Reinforce indoor setting |
| Simple/clean look | `busy, cluttered, messy` | Keep composition clean |

## No-panel doctrine (important)

NAI V4.5 renders **one coherent image**, not comic panels. `2koma`, `4koma`, `comic`,
`panel`, `split screen`, `before and after`, `multiple views` are weak, unreliable steering
tags — they tend to produce a single muddy subject rather than clean separate panels. So:

- **Keep these tags in the negative by default** for normal single-subject scenes.
- **Never try to render a before/after as one split image.** Do it as **two separate
  generations** sharing a reference anchor (see `natural-language-hybrid.md` Technique 8 and
  the `/story` Progression Pair pattern). This is the genuinely reliable path.
- The only time these belong in the **positive** is a deliberate multi-view character sheet
  (`/sheet`), and even then it is composition-as-archive, not narrative panels.

If a genre or arc puts `2koma`/`split screen` in the positive (legacy fallback), you MUST
drop the matching tags from the negative for that one render — otherwise the negative fights
the positive. Prefer the two-generation path over fixing this conflict.

## V4.5 Negative Emphasis (in positive prompt, NOT negative field)

Use `-weight::concept::` syntax in the **positive prompt** for targeted removal. This is more precise than the negative prompt field for specific unwanted elements.

### Common Negative Emphasis Tags

| Tag | Effect | When to Use |
|-----|--------|-------------|
| `-1::monochrome::` | Forces color output | When color is critical |
| `-1::simple background::` | Encourages detailed backgrounds | When background matters |
| `-2::flat color::` | Increases shading detail | When detailed rendering is needed |
| `-1::text::` | Suppresses unwanted text | When no text is desired (reinforce `no text`) |
| `-6::simple illustration::` | Adds complexity and detail | When maximum detail is wanted |
| `-1::chibi::` | Prevents chibi proportions | When realistic proportions are needed |

### When to Use Negative Emphasis vs Negative Prompt
- **Negative prompt field**: Broad quality control, anatomy fixes, general style steering
- **Negative emphasis in positive prompt**: Targeted removal of specific concepts, precise control

### Negative Emphasis is Preferred for Precision
On V4.5, `-weight::concept::` in the positive prompt is **more effective** than the negative prompt field for removing specific unwanted elements. The negative prompt field acts as a broad filter, while negative emphasis surgically targets individual concepts.

**Best practice**: Use negative prompt field for the default quality/anatomy block. Use `-1::concept::` for anything scene-specific you want to suppress.

**Example — suppress unwanted elements precisely:**
```
Positive: masterpiece, very aesthetic, artist:ciloranko, 1girl, ..., -1::monochrome::, -1::text::
Negative: worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, ...
```

## Selecting Situational Negatives

When building a prompt, automatically:
1. Always include the default negative
2. Scan the positive prompt for framing tags → add relevant situational negatives
3. Check if `1girl` or `1boy` only → add multi-character prevention
4. If outfit is the focus → add `holding, carrying` prevention
5. Present all negatives in the structured breakdown for user review before finalizing
