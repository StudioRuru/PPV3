# Generation Parity with the NovelAI Web Client — Plan 10 (sub-project 1 of 6)

> Executed inline. Design approved in chat 2026-10-14. Sub-projects after this: 2 settings UI, 3 camera roll, 4 closet/workshop, 5 chat 2.0, 6 mascot; ComfyUI local-generation product gets its own spec.

**Goal:** requests that match what NovelAI's web client sends for V5, so quality, SFW/NSFW, mode, effort and positions behave like the web app; cost + MB on results; NovelAI metadata on every saved PNG.

## Findings this plan rests on (2026-10-14)
- The web client composes quality tags and UC preset text client-side; the backend does not expand `qualityToggle`/`ucPreset` (MooshieUI PR #734, consistent with NovelAI docs listing the strings).
- V5 quality tags (appended at the end): Standard `, very aesthetic, masterpiece, no text`; Light `, very aesthetic, amazing quality, no text` (docs.novelai.net/en/image/qualitytags).
- V5 Full UC presets (docs.novelai.net/en/image/undesiredcontent): Heavy, Light, Human Focus, Furry Focus — texts in `nai-body.ts`.
- On Full models with a preset, the web UC starts with `nsfw,` unless the prompt contains "nsfw" → SFW/NSFW toggle semantics.
- Furry mode = prompt begins with `fur dataset,` (docs.novelai.net/en/image/models).
- Effort Medium = model `nai-diffusion-5-full-medium`, 14 steps, Euler Ancestral, Heavy UC preset, no custom/character UC, no cfg_rescale (NovelAI announcement 2026-10-08; zer0-novel-utillities PR #11).
- Web metadata (user's V4.5 PNG): `v4_negative_prompt` has `use_coords:false, use_order:false, legacy_uc:false`; `v4_prompt` has `legacy_uc:false`. Ours sent coords/order true on the negative.

## Global constraints
- Rating is SFW | NSFW only; stored "off" migrates to SFW (web default with a preset is SFW).
- Position words default OFF (user suspects they mask coordinates); toggle stays.
- Unverified: `tag_hint_*` fields — not sent (cost if wrong: none observed).

## Review focus
1. Old drafts/recipes (rating "off", no mode/effort/quality/preset) → sensible defaults, no crash.
2. Medium effort with V5 Curated selected → effort ignored (Full only).
3. NSFW toggle when the user already typed "nsfw" → no duplicate.
4. Upscaled PNG keeps a NovelAI-readable Comment (re-import works).
5. Cost measurement failing (balance unreachable) → generation still succeeds, cost shown as unknown.

## Tasks
1. `nai-body.ts`: GenMode/Effort/Quality/UcPreset, composition, negative-caption flags. Tests.
2. `prompt.ts`: rating SFW/NSFW semantics (prepend), "off" migration, position words default off. Tests.
3. ParamsBar: Mode, Effort, Quality, UC preset, SFW/NSFW toggle (full redesign is sub-project 2).
4. Upscale metadata: copy source text chunks. Test.
5. Cost (balance diff) stored per generation; size in MB; shown under the preview.
6. Verify, review, deploy.
