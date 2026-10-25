# Sprites rebuild: Miyabi LoRA, new pose model, quality clips

Date: 2026-10-25 · Status: for owner approval

## Intent

Sprites is broken and, when it worked, Miyabi didn't look like the same girl from pose to pose. Poses came from
Qwen-Image-2.1 edit; its noctQ unet was removed and the 33 GB Qwen 2.1 base was never downloaded, so no new pose
can be made today. The owner wants the whole thing fixed: working again, better poses, better motion — and above
all **one consistent Miyabi**, the same on the Stage and in Chat, in every pose, expression and outfit.

Owner's ask: "what can we do to migrate or change over the 'animation' tools needed to make Sprites better?"

## Decisions the owner made

1. **Scope: all of it** — get it working, better poses, better motion.
2. **Consistency target: both surfaces, consistent.** Stage poses and Chat expressions show the same face, body
   and hair in every pose and outfit.
3. **Her look is defined by a trained LoRA of her**, not by a single reference image.
4. **Motion stays generated Wan clips** between approved frames (as now). No puppet rig, no Live2D-style rig.
5. **Training set: generated fresh**, using **NovelAI with her character tags** (her existing profile tags).
6. **Clips: quality first** over speed and pod time.
7. The playback of the draft design ("two LoRAs, pose step moves off Qwen 2.1, Wan uses her LoRA, prompt carries
   the outfit") was answered "looks right".

## How it fits together

```
NovelAI (her tags) ──► pick set (owner) ──► AI-Toolkit on main pod
                                              ├─► Miyabi image LoRA  (pose model family)
                                              └─► Miyabi Wan LoRA    (Wan 2.2 14B I2V)
approved base ──► pose model edit + image LoRA ──► 13 Chat + 14 Stage frames per outfit
approved frames ──► Smooth Mix Wan FLF + Wan LoRA ──► clips ──► Mac cutout (unchanged)
```

## Research findings (2026-10-25, web)

- **AI-Toolkit trains Flux 2 Klein LoRAs.** BFL's own docs list it; recommended target is the **Klein base**
  checkpoint (adapter still loads on distilled builds); 4B is the safe size, 9B has reported training collapse.
  Sources: docs.bfl.ai flux2_klein_training; HF blog "Fine-tune FLUX.2 [klein] with a LoRA"; RunComfy guides.
- **AI-Toolkit trains Wan 2.2 14B I2V LoRAs** (high- and low-noise experts). 24 GB is the floor, 48 GB+
  comfortable; start 512–768 px, rank 32. Face drift under motion is the main failure a character LoRA fixes;
  dataset wants front / three-quarter / side views, expressions, lighting variety.
- **Klein reference edit works in ComfyUI** via ReferenceLatent nodes (1–3 reference images); Comfy.org ships a
  Klein 9B image-edit template. Pose is driven by prompt (+ optionally a pose reference image); no dedicated pose
  control model. No published pose-fidelity benchmark — needs our own test.
- **Not confirmed anywhere:** that AI-Toolkit can train on **MOSS** (our `pornmasterMoss_v1`, MOSS-Image arch:
  Qwen3.5-9B encoder + flux2 VAE). MOSS is related to Klein but is its own model type in ComfyUI (`moss_image`).

## Pod facts (from the repo)

- Clips run on **Smooth Mix Wan 2.2 14B I2V** high+low (`video-i2v.json`), which has **lightx2v baked in**:
  designed for 8 steps, cfg 1. More steps buys little; quality comes from resolution, frames and the LoRA.
- `spriteRecipe` today: 480p, 8 steps, cfg 1, 30 fps, motion low, `loras: []`; Chat moves 0.75 s, idles and Stage
  2.5 s; idle = loop (start frame = end frame).
- Main pod driver max CUDA 12.8; AI-Toolkit installed (cu128), SDXL training works. Main pod is the 48 GB class
  (A6000-measured, `src/lib/comfy/estimate.ts`), i.e. the "comfortable" tier for Wan 14B I2V training; 720p i2v
  is estimated at ~36 s/step-unit vs 13 at 480p.
- Each surface × outfit has one `@base` key; poses are edits from it, clips run between approved keys
  (`store.ts`). Re-approving the base un-approves everything else in that set.
- Cutout already scales every frame to a fixed width (Chat 360 px, Stage 480 px, `cutout.ts`), so 720p clips need
  no cutout or UI change.

## Calls made by Claude (owner to check)

- **Pose model choice is gated by a training check.** First choice: MOSS (already on the pod, owner liked it). If
  AI-Toolkit can't train a MOSS LoRA, fall back to **Flux 2 Klein 4B base** for poses (new download — size and
  source stated and approved before fetching). Qwen 2.1 stays parked either way.
- **Training set size: ~40 picks** from ~80–100 NovelAI renders, spread over angles, expressions from the 13
  Chat keys, all 3 outfits, and full-body Stage poses. Anlas cost is shown and approved before generating.
- **Captions:** NovelAI tags minus her identity tags, plus one trigger word (`miyabi_sprite`), so outfit and pose
  stay promptable and the identity lives in the trigger.
- **Wan LoRA trains on images only first** (the same picks); add short clips later only if faces still drift.
- **Quality-first clips:** 720p (from 480p), keep 8 steps / cfg 1 (lightx2v), Wan LoRA on both high and low
  noise, strength found by test. Clip lengths unchanged.
- **Outfit lives in the prompt** (day / night / lewd tags), not in separate LoRAs.
- **Existing approved sprites are kept** until the owner approves a replacement set; nothing is deleted.
- **Cheap tests before batches:** 3 test poses and 2 test clips with the LoRA before any full 27-key × 3-outfit
  batch. The owner judges by eye in the existing Sprites approve/reject flow; no face-similarity scoring.
- **New bases, everything regenerated.** Each surface × outfit gets a fresh `@base` made with the pose model + her
  LoRA (text-to-image, outfit in the prompt), approved by the owner; every pose and clip is regenerated from it.
  Old Qwen-made sprites are not reused as endpoints or training data.
- **MOSS-or-Klein gate:** first a config/code check of AI-Toolkit for a MOSS model type; if one exists, a short
  trial run (few hundred steps, approved first) decides. A Klein 4B download is a hard stop for owner sign-off.
- **Trigger in clips:** Wan prompts include `miyabi_sprite`; the 2 test clips compare with and without it.

## Goals

- Sprites can make new poses again.
- Side by side, any two of her frames (any surface, pose, outfit) read as the same girl.
- Clips keep her face through the motion; idles loop without a visible jump.

## Non-goals

- A rig / skeletal animation, lip-sync, or real-time animation.
- New sprite keys or outfits (the editable lists stay as they are).
- Downloading Qwen-Image-2.1, the face-fill doc, the SDXL face test (still parked).
- LoRAs for other characters (the pipeline may allow it later; not built now).

## Anti-goals (failure even if it works)

- Any GPU time, Anlas or download spent without the owner saying yes for that batch.
- A pose that changes her face, hair colour, eye colour or body between keys.
- Clips where she morphs mid-move, or idles that pop at the loop point.
- Losing the current approved sprites before the new ones are approved.
- Age wording in any prompt or caption; negative tags are not adjusted ("she's 100% adult").

## Constraints

- Studio: Next.js 16 in `studio/`. Sprites: `src/lib/sprites/{graph,service,store,cutout}.ts`; trainer already
  in the app (AI-Toolkit on the main pod); LoRA import/list exists (`src/lib/comfy/loras.ts`).
- NovelAI generation through the app's existing NAI client; never print the NovelAI token.
- Model lookups via civitai.red only. Installs on the pod beyond AI-Toolkit/Impact Pack need permission.
- Each training run, render batch, Anlas spend and download is approved by the owner separately.

## Left to the builder

- How the pose edit graph is wired (ReferenceLatent chain vs MOSS's own edit path), and whether a pose
  reference image is used alongside the prompt.
- AI-Toolkit configs (rank, steps, LR, resolution) within the research ranges above.
- Where the training-set picker lives in the UI (Trainer tab vs Sprites tab) and how picks are stored.
- How the two LoRAs are recorded so Sprites picks them up automatically.
- Loop-seam handling for idles if 720p shows a seam.
