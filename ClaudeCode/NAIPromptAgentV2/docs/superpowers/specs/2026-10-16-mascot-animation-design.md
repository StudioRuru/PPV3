# Mascot animation (layers 1 + 2) — Design

> Approved in chat 2026-10-16. Sub-project C after fix pack A. Reference studied: github.com/aldegad/sprite-gen (Apache-2.0) — borrowed ideas only (same-source frame rows for identity, background cut, atlas + manifest, code-driven idle "breathe"); its providers (OpenAI/Codex, xAI Grok) refuse NSFW and bill per call, so frames are made with NovelAI. Layer 3 (video-smooth clips from an open image-to-video model on a rented GPU via ComfyUI) is a future upgrade; this design leaves a slot for it.

## Goal
Miyabi (roaming stage + Chat portrait) and Aru (shop portrait) feel alive and involved in the app: always-on idle life, talking mouths while replies stream, short reactions to what happens, and hop-steps between spots — as smooth as the device allows, never blocking the UI.

## Decisions (owner)
- Motions: idle life, talking, reactions, locomotion (all four).
- Build layers 1 + 2 now; layer 3 (generated video clips) arrives with the ComfyUI build and will be compared as an upgrade.

## 1. Live runtime (layer 1)
- `SpriteCanvas`: one tiny WebGL renderer (no new dependency) drawing the current frame on a grid mesh (~16×24 vertices) with one vertex shader, `requestAnimationFrame` only while visible (IntersectionObserver + `document.hidden` pause).
- Region deformation without rigging, in normalised sprite space (y=0 top):
  - **head/hair band** (y < 0.3): sway (sine, 3–5 s, ±1.5°-equivalent shear) + tilt offsets from events;
  - **chest band** (0.3 ≤ y < 0.55): breathing (vertical scale 1 ± 0.012, 3.5 s);
  - **whole body**: squash/stretch impulses (poke, drop, land, hop) as damped springs;
  - **drag**: hair/tail spring lag — top band shears opposite to drag velocity, settles with damping.
  - Bands are tunable per pose (lie/sit use x-bands) via a small table; back view uses the same bands.
- Frame swaps (expression change, clip frames, pose change) crossfade over 80–160 ms inside the shader (two textures, mix factor) — never a hard cut.
- Reduced motion → no warp, no crossfade (instant), clips show their middle frame; WebGL unavailable or context lost → today's `<img>` path.
- Locomotion (until layer 3): moves become 2–4 small hops along the path (translate arcs with squash on take-off/landing, slight forward tilt), duration scaled by distance; the existing transform-based Stage positioning stays the source of truth.

## 2. Frame clips (layer 2, NovelAI)
- Clip kinds per *base sprite* (any bust, pose or talk portrait image):
  - `blink`: 1 frame (eyes closed) via **inpaint** of an eye mask;
  - `talk`: 2 frames (mouth slightly open, open) via inpaint of a mouth mask (talk portraits and busts; poses optional);
  - reactions `laugh`, `pout`, `wink`, `wave`, `jump`: 3–4 frames each via **img2img** from the base sprite at strength 0.40–0.50 (wave/jump up to 0.55) with the reaction tags appended; same seed across a clip's frames with per-frame tag nudges (e.g. wave: `waving, hand up` → `waving, hand to side`).
- Masks: eye/mouth boxes come from the tagger sidecar's face detector if available, else a per-kind default box relative to the sprite (busts/portraits: face ≈ upper-centre) that the owner can nudge in the studio; masks are stored with the clip.
- Inpainting is added to the NovelAI body builder (`action: "infill"`, mask PNG, same free-tier limits: ≤ 1 Mpx, ≤ 28 steps); img2img already exists. Never send upscaled/oversized sources (existing guard).
- Every frame is cut out with the tagger `/cutout` (as sprites are today) and aligned to the base sprite's canvas (same size, same anchor) so frames register.
- Storage: `<spriteDir>/clips/<baseKey>/<kind>/<n>.png` + `<spriteDir>/clips/<baseKey>/manifest.json` (`{ kind: { frames, fps, loop, mask? } }`); served by the sprite route with the same whitelist rules (kind and frame index whitelisted, baseKey validated against existing sprite keys). Packing into a single atlas per base sprite is done at serve/build time only if it measurably helps; frames as separate PNGs are acceptable first.
- Profiles: Miyabi (active slime look) and Aru (her profile) — clips live under each profile's sprite dir.

## 3. Playback
| Moment | Clip |
|---|---|
| always | idle runtime + `blink` every 2.5–6 s (randomised; not when empty slime) |
| reply streaming (Chat tab, Aru's shop) | `talk` frames alternating at ~8 fps, paused on whitespace/punctuation bursts; ends on the reply's expression |
| poke | `laugh` or `pout` (by mood) |
| pat | `wink` (or laugh) |
| flick / drop | squash + `pout` |
| generation done / potion brewed | `jump` or `wave` |
| move to a new spot | hop-steps (runtime) |
- A `ClipPlayer` (pure state machine: queue, one-shot vs loop, priorities talk > reaction > blink > idle, return-to-expression) drives `SpriteCanvas`; missing clips fall back to the still + runtime.
- Empty slime: no clips, no blink, still warped minimally (breathing only) and dimmed, as today.

## 4. Studio
- Sprite studio gains a **Clips** tab per character → base sprite (pick from existing sprites) → kind grid with frame previews and playback preview; "Make clips for this sprite" / "…for all sprites of this outfit" with one confirm showing count + estimate, sequential, Stop, stop on first error; redo per clip (pick from candidates like sprites); mask nudge editor for eyes/mouth.
- Sub-project B later moves bulk clip generation to the background queue + island progress.

## 5. Error handling
- Generation: estimate first, confirm, stop on first error, nothing replaced on failure (studio rules). Bad masks → clip marked failed, still usable sprite.
- Runtime: any WebGL error → `<img>` fallback for that instance; animation loops paused when hidden; one rAF per visible canvas, capped at the display rate.

## 6. Testing
- TDD: ClipPlayer state machine (priorities, one-shot return, loop stop, missing clip fallback, empty slime), deformation band math (pure functions: vertex offset for (u,v,t,state)), hop path generator, clip request builders (img2img strength/tags, inpaint body with mask, seeds), manifest validation + path whitelist, mask defaults.
- Live check on a scratch DB with a few generated clips: idle warp smooth on phone width, talk during a real reply, reactions on poke, hops between spots, reduced-motion fallback.

## Out of scope
Layer 3 video clips (ComfyUI build), skeletal rigging/Live2D, sound, background bulk generation (sub-project B).
