# LoRA Trainer (AI-Toolkit on the main pod) — plan

**Goal:** pick 10–30 photos of a face (or a scene/style) in the app, tap Train, and get a LoRA that shows up in the LoRA picker a little later.

**Status:** waiting for approval. Nothing is installed yet.

## Choices
- **Trainer:** [ostris/ai-toolkit](https://github.com/ostris/ai-toolkit), pinned to `14f8f95` (main on 2026-10-22). It officially supports **Qwen-Image-2.1** and **SDXL**, which are the two families the studio renders with.
- **Where it runs:** the main pod (L40, 48 GB). It uses the CLI only (`run.py config.yaml`). The AI-Toolkit web UI and its "manager" are not used.
- **Base weights:**
  - **Qwen:** train against `Qwen/Qwen-Image-2.1`, the diffusers repo, **33.1 GB** stored once on the persistent volume. The LoRA should carry over to the noctQ finetunes because they share the same base.
  - **SDXL:** train directly on `waiIllustriousSDXL_v170.safetensors`, which is already on the volume.

## Pod side
1. Add a new `trainer` step to `install.sh`:
   - git-pin ai-toolkit into `/opt/ai-toolkit`.
   - Give it **its own venv** (`/opt/ai-toolkit/venv`), so ComfyUI's torch and deps are never touched.
   - Install requirements only. Touch the marker `trainer`.
2. Download the Qwen base on first train via `huggingface-cli download` into `/opt/comfy/models/train-base/qwen-image-2.1`, skipped if it is already there.
   - Volume space must be checked first: 150 GB volume, ~33 GB needed.
3. Each run lives in `/opt/train/<id>/` (dataset + `config.yaml` + log) and is launched with `systemd-run --unit train-<id>`, so it survives ssh drops.
   - The output goes straight to `/opt/comfy/models/loras/<name>.safetensors`.

## App side
- **`src/lib/comfy/train.ts`:**
  - `buildConfig({ name, base, kind, trigger, images })` produces the AI-Toolkit YAML:
    - rank 16, lr 1e-4, bf16.
    - Steps: Qwen 1500, SDXL 2000. Resolution: Qwen 1024, SDXL 1024.
    - Qwen uses `low_vram: false`, since the L40 has room.
  - `startTrain` streams the images and config over the existing `ssh()` helper from `loras.ts`, then runs systemd-run.
  - `trainStatus` reads the last progress line (`step x/y`) from the log.
  - Unit tests cover the YAML builder.
- **Captions:**
  - Face: `"<trigger>, photo of a person"` for every image.
  - Scene/style: the image's stored prompt when it comes from the Library, otherwise just the trigger.
  - No auto-captioner (skipped; add Florence/JoyCaption only if results show it's needed).
- **`/api/comfy/train`:**
  - POST starts a run (images = Library item ids and/or uploads; reuses the Library store).
  - GET returns progress.
  - One run at a time.
- **Engine:**
  - While a run is active, main reports `training`: the idle-hibernate tick skips it, and new render jobs wait with a "Training — renders resume after" note.
  - `dropModels()` runs before the start so ComfyUI frees VRAM.
  - When the run finishes, the engine pulls the LoRA back to `data/comfy-loras/`, so `pushLoras` restores it after any pod reflash, and the picker refreshes.
- **UI:** a "Train LoRA" sheet in the ComfyUI tab with:
  - name, Face/Scene toggle, Qwen/SDXL toggle, and a photo picker (Library multi-select + Files import, 10–30 images);
  - a cost/time estimate, and a progress bar that keeps updating while you're on other tabs.

## Cost (estimates until the first real run)
| Run | Time on L40 | ≈ Cost |
|---|---|---|
| One-time Qwen base download (33 GB) | 5–10 min | ~$0.15 |
| SDXL face LoRA, 2000 steps | ~25–40 min | ~$0.50–0.70 |
| Qwen 2.1 face LoRA, 1500 steps | ~60–90 min | ~$1–1.50 |

## Needs your yes before it happens
- Installing ai-toolkit (third-party code plus its pip deps) on the main pod.
- Downloading Qwen-Image-2.1 base weights (33.1 GB, Apache-2.0, from huggingface.co/Qwen).
- GPU time for one test run (suggest an SDXL face first: cheapest, fastest feedback).

## Out of scope for now
- Video (Wan) LoRA training, which AI-Toolkit supports; add later if wanted.
- Auto-captioning, multi-run queue, and sample previews during training.
