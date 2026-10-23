# Mac studio: desktop layout for the Photo tab

Date: 2026-10-23 · Status: for owner approval

## Intent

The owner fine-tunes big ComfyUI renders and wants the Mac's big screen for it. Today the ComfyUI tab is
phone-shaped: one column, small image, LoRAs as bare file names, and nothing to say whether a LoRA even fits
the chosen model. On the Mac they want to see the render large, step back through earlier takes, pick LoRAs
knowing they fit, and have Miyabi help fix what's off.

Owner's original ask: "a mac accessible interface that allows Miyabi to also work on desktop. Can also work as
an expanded comfyui menu for more advanced generations." Brainstorm answers: fine-tune big renders; Miyabi as a
copilot in the studio; compare & iterate plus model/LoRA browsing.

## Decisions the owner made

1. **Where:** the existing studio in a Mac browser (:3100 / tailnet). No native app, no separate window. A wide
   viewport switches the ComfyUI tab's **Photo** pane to a desktop layout; the phone layout is unchanged.
2. **Scope:** Photo only. Video, Library and Sprites keep their current layouts for now.
3. **Layout:** four columns, left to right:
   - Settings column: model, LoRAs, prompt, settings, Render.
   - **Vertical** history strip of takes, newest on top.
   - Main image, full and centered, as large as the window allows.
   - Miyabi panel.
   (Chosen from mockup "C · Big view + history strip", with the strip made vertical so the image gets the centre.
   Mockup: `.superpowers/brainstorm/44392-1792782790/content/mac-layout-v2.html`.)
4. **History strip:** tap a take to restore its settings; hold/press a take to compare it with the main image.
5. **LoRA fit:** the LoRA list only shows LoRAs that fit the selected model's family, with a "show all" switch.
6. **Trigger words:** adding a LoRA auto-inserts its trigger words into the prompt and sets its suggested
   strength; removing it takes those words back out.
7. **Miyabi copilot = suggest, you click.** She explains what went wrong and offers a fix with an **Apply**
   button. She never changes settings or spends GPU time on her own. Apply edits the settings; Render stays
   the owner's button.
8. **How she knows what's wrong: the owner tells her.** Quick chips ("face drifted", "too plastic", "bad hands",
   "LoRA too strong", "wrong pose", "blurry") or typed text. She reads that plus the current settings and LoRA
   info. She does not look at images (no vision model).
9. **LoRA improvements on the phone too.** Decisions 5 and 6 change the one shared LoRA list (`LoraStack.tsx`),
   so the phone also gets fit filtering, "show all" and automatic trigger words.
10. **Photo gets its own prompt.** Today `ComfyScreen.tsx` holds one prompt shared by Photo and Video. Split it
   so each pane keeps its own (phone and Mac), and trigger words, take restores and Miyabi fixes never touch
   the Video prompt.

## Calls made by Claude (owner to check)

- **Pose and Swap head stay** in the desktop settings column, as on the phone. Restoring a take restores its
  pose/swap images too, since the recipe stores them.
- **Miyabi's copilot is its own short conversation**, not her Chat tab thread: a small task-focused route on the
  quick tier in her voice, so tuning chatter doesn't land in her chat history.
- **Switching model** already clears the LoRA stack (`PhotoPane.tsx:43`); it also strips those LoRAs' inserted
  trigger words.
- **Miyabi's fixes never change the model**, because that wipes the LoRA stack. She can change prompt, LoRA
  strengths, steps, cfg, sampler/scheduler, size and seed.

## Goals

- On a wide screen, the Photo pane is comfortable for a long tuning session: big image, every take one tap away.
- Choosing a LoRA never needs a trip to civitai.red to check its base model or trigger words.
- Miyabi turns "her face drifted" into a concrete, one-tap settings change.

## Non-goals

- Video, Library, Sprites desktop layouts (later, if Photo works out).
- Sweep/XY grids and batch variations.
- Searching or downloading new models from inside the studio.
- Miyabi viewing renders, auto-critiquing, or re-rendering by herself.
- A native Mac app.

## Anti-goals (would be a failure even if it works)

- The phone layout changes or gets worse (the phone does gain the LoRA info and a separate Photo prompt, by decision).
- Miyabi applies a change, or anything spends GPU time, without the owner tapping.
- A LoRA the owner relies on silently disappears because its family was guessed wrong (hence "show all").
- Trigger words duplicate in the prompt, or removal deletes words the owner typed themselves.

## Constraints

- Next.js 16 studio in `studio/`; Photo UI in `src/components/comfy/PhotoPane.tsx`, LoRA UI in `LoraStack.tsx`,
  recipe and model family in `src/lib/comfy/recipe.ts` (`family()`: sdxl / qwen / krea2 / moss).
- LoRA names come from the pod's ComfyUI `object_info` (`listModels` in `src/lib/comfy/client.ts`), so the list
  is only known while the pod is up. Every LoRA is either in `pod/comfy/models.manifest.yaml` (sha256 known) or
  stored on the Mac (Files imports and trained LoRAs, `src/lib/comfy/loras.ts`).
- Miyabi's chat runs on the Mac's Ollama (quick tier, Gemma 4 E4B, `src/lib/tiers.ts`). Her persona lives in
  `src/lib/persona.ts` / `src/lib/mascot/`.
- Model lookups go to civitai.red only. Never print or log `CIVITAIRED_KEY`.
- No Anlas spend and no pod time is needed to build or test this; the LoRA info lookup is free.

## LoRA info (fit, trigger words, strength)

Sources, in order:
1. The LoRA file's safetensors header metadata (e.g. `ss_base_model_version`, `modelspec.architecture`,
   `ss_tag_frequency`), for files stored on the Mac.
2. civitai.red lookup by sha256 (manifest LoRAs already carry it; Mac files get hashed once): base model,
   trained words, recommended weight.

Looked up once per file and remembered. Family mapping from those base-model strings onto `family()`'s families
is the builder's call; anything unknown counts as "fits everything" rather than being hidden.

## Takes / history

The strip shows this tab's recent Photo takes. A take = the rendered image + the full `PhotoRecipe` that made
it, so restoring is exact.

## Left to the builder

- The width breakpoint, and whether the strip/Miyabi columns collapse on mid-size windows.
- Where take history comes from (existing Library/job records vs. a new list) and how many takes the strip holds.
- Compare interaction details (hold-to-flip, slider, or side-by-side overlay).
- The exact chip list and Miyabi's prompt; how her suggestion is turned into an applicable settings patch
  (structured output from the model vs. a rule table per chip with her wording on top).
- Storage for remembered LoRA info.
- Keyboard shortcuts (nice to have).
