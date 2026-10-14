# Generation Controls — Implementation Plan (Plan 8)

> Executed inline (Native). Design approved in chat 2026-10-14.

**Goal:** stronger character placement (region boxes + automatic position words + left→right order), sampler/schedule/guidance-rescale controls, 2×2 image-to-image variations, NovelAI 4× upscale with Anlas balance shown before and spent after.

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` §4.2 (+ this design).

## Global constraints
- Position words are added at compile time (never stored in lines); `PromptState.positionWords` (default on) toggles them. Only in Custom position mode.
- Custom mode sends characters sorted by box centre x (stable); UI box numbering is unchanged.
- Samplers: k_euler, k_euler_ancestral, k_dpmpp_2s_ancestral, k_dpmpp_2m, k_dpmpp_2m_sde, k_dpmpp_sde. Schedules: karras/exponential/polyexponential (k_dpm_2-style restrictions not needed for this list).
- Variations use the source generation's own recipe (state + params), img2img at its size, 4 seeds, 2 s apart, saved with grid_id `v…`. Upscale: `api.novelai.net/ai/upscale`, scale 4, zip response, saved as a generation (grid_id `u<id>`).
- Anything that may spend Anlas shows the balance first and the spend after (balance diff). No silent retries that spend.

## Review focus
1. Old drafts/recipes without `region` or `positionWords` → behave as before (centre dots → small default region; words on).
2. Upscale / img2img failure (402, network) → readable error, no generation row saved.
3. Region resize past canvas edges → clamped, min size, never NaN.
4. Sampler change to one whose current schedule is invalid → schedule snaps to a valid one.
5. Variation source deleted / missing file → 404 message.

## Tasks
1. `lib/prompt.ts` regions: `Region`, `regionOf`, `positionWords`, compile ordering + words. Tests.
2. `RegionCanvas` (move + corner resize) replaces dots in `PositionCanvas`.
3. `lib/nai-body.ts` SAMPLERS / `schedulesFor`; ParamsBar "More". Tests.
4. Anlas balance: `anlas()` + `/api/anlas`.
5. img2img: `buildNaiBody` img2img fields (test), `/api/generate` `source`, `VariationSheet`.
6. Upscale: `upscaleImage()` + `/api/upscale` + confirm sheet.
7. Typecheck, tests, build, fresh review, deploy.
