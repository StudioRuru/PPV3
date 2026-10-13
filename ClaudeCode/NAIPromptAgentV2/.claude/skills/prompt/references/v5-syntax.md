# NovelAI Diffusion V5 — Prompt Syntax Reference

Default model for this tool: **V5 Full** (`nai-diffusion-5-full`). V5 Curated
(`nai-diffusion-5-curated`) is cleaner/safer but has roughly half the prompt budget. V4.5
rules live in `v45-syntax.md` and apply only when V4.5 is chosen deliberately (see
"V4.5-only features" below).

## What changed from V4.5
- New architecture, ~2× V4.5's size. Tags remain **fully supported**; natural language is now
  understood well. Mix both: tags for exact appearance, prose for composition, camera, action,
  relationships and comic layout.
- Prompt languages: English and Japanese officially. English is usually more precise.
- **Budget:** ~1,471 effective tokens over the base prompt on V5 Full (~703 on Curated), plus
  ~750 tokens of rendered text (~374 on Curated). The old 512-token pruning rule is gone — stop
  cutting useful tags for budget. Still avoid redundant tags: duplicates add noise, not strength.
- **Tag position is no longer a reliable strength lever.** Put the most important content in the
  front half for readability, but use numeric weights when something must dominate.

## Ordering (base prompt)
1. Subject count (`1girl, solo`) and any dataset prefix (`fur dataset,` / `background dataset,`).
2. Character name tag(s), then appearance, outfit, pose/expression.
3. Scene, framing/camera, lighting.
4. Style: artist tags, medium, era (`year 2025`, `meta:novel era`, `meta:golden era`).
5. Quality + complexity last: `masterpiece, very aesthetic, high complexity`.

## Weighting
- Numeric: `1.3::tag::` strengthen, `0.8::tag::` weaken, a run can wrap several tags:
  `1.2::rain, night::`. A bare `::` closes a run.
- Negative weights remove/invert in the **positive** prompt: `-1::hat::`, `-2::flat color::`.
- Tiers (unchanged): defining `1.3` (max 1–2 tags), key `1.15` (a few), de-emphasis `0.9`.
  Most tags unweighted. Over-weighting makes tags compete.
- Large weights are now used deliberately for hard switches, e.g. `2.1::transparent background::`.

## New V5 tags and prefixes
| Tag | Effect |
|---|---|
| `high complexity` | Recommended default for normal detailed images |
| `low complexity` / `medium complexity` / `ultra complexity` | Deliberately simpler / denser |
| `transparent background` | Transparent backdrop (weight it ~2 for reliability) |
| `has alpha` / `alpha transparency` | Alpha-channel output / see-through effects |
| `depthness` | Adds shading depth |
| `meta:novel era`, `meta:golden era` | Era look bias |
| `visual novel art`, `visual novel bg`, `visual novel cg`, `visual novel chibi`, `visual novel sprite` | VN styles |
| `attractive male` | Custom male-appeal tag |
| `fur dataset,` (prefix) | Furry mode |
| `background dataset,` (prefix) | No-people photographic scenes, landscapes, still life |

## Characters
- Up to 22 characters. One **character box** per character; in each box write `girl`, `boy` or
  `other` (no number) plus that character's tags. Do not also use `|` in the base.
- Positions: "AI decides" by default, or free placement on the canvas (V5 reworked this — no
  5×5 grid limit).
- Interactions: in the relevant boxes use `source#action`, `target#action`, `mutual#action`
  (e.g. `source#hug` in one box, `target#hug` in the other).
- Quality/era/artist/complexity tags belong in the **base**, never in a character box.

## Text in images
- Quote the text in the prompt (`a sign that says "OPEN"`); V5 builds the `Text:` block
  automatically. Writing your own `Text:` block disables the automation.
- If short text fails to appear, turn **Add Quality Tags** off (its `no text` suppresses it).

## Comics (new in V5)
V5 can render a full multi-panel page in one generation: describe the page and panels in
natural language and/or position character boxes. This **replaces the V4.5 no-panel
doctrine for comic requests** — only keep `comic, panel, 2koma, 4koma, multiple views` in the
negative when you want a single coherent image.

## Undesired content (negative)
Baseline unchanged (see `negative-prompts.md`). Add scene-specific removals. Prefer negative
weights in the positive prompt for one precise concept.

## V4.5-only features (not on V5 yet)
**Precise Reference** (character/style reference) and **Vibe Transfer** are not available on
V5 at launch. Any workflow that needs them — style recreation from pixels, "use Scene 1 as
Character Reference" for arcs — must say **"switch this step to V4.5 Full"**. On V5, carry
consistency with: identical character tags, a fixed seed, saved prompt chunks, and
tagger-derived artist tags.

## Cost (Opus)
V5 free generations have a usage limit (earlier models stay unlimited). Free-generation
conditions: 1 image, ≤1,048,576 px (832×1216 fits), ≤28 steps, no base image.

## Recommended defaults
832×1216, 28 steps, guidance 5, Euler Ancestral (varied) or Euler / DPM++ 2M with a fixed seed
(reproducible), Add Quality Tags off when you control quality tags yourself.
