# Sprites rebuild — pod recon (Task 1, G1)

Date: 2026-10-25 · Main pod `nai-comfy-main` (100.99.192.62) · read-only: nothing trained, rendered or downloaded.

## AI-Toolkit (commit 14f8f95)

- Archs present: `moss_image`, `flux2_klein_4b`, `flux2_klein_9b`, `wan22_14b_i2v`, `wan22_14b`, `qwen_image_2`, `krea2`.
- `AIT_ARCH = { moss: "moss_image", wan22: "wan22_14b_i2v" }`. Klein not needed.
- **POSE_FAMILY = "moss"** — MOSS trains from local files; no Klein download.

## MOSS image LoRA

- `model.name_or_path`: `/opt/comfy/models/diffusion_models/pornmasterMoss_v1.safetensors` (5.4 GB, present)
- `model.te_name_or_path`: `/opt/comfy/models/text_encoders/qwen3.5_9b_int8_convrot.safetensors` (int8_convrot supported)
- `model.vae_path`: `/opt/comfy/models/vae/flux2-vae.safetensors`
- **Download on first run:** with a local base the tokenizer falls back to HF `OpenMOSS-Team/MOSS-Image-SFT` `tokenizer/`
  (tokenizer.json ~20 MB + config + chat_template). Needs owner OK (G5).

## Wan 2.2 I2V LoRA

- Arch `wan22_14b_i2v`; needs a diffusers dir (transformer + transformer_2). Can't load the Smooth Mix single files.
- Base: HF `ai-toolkit/Wan2.2-I2V-A14B-Diffusers-bf16` — **57.2 GB**, plus `ai-toolkit/wan2.1-vae`. quantize/low_vram on.
- `train_high_noise` / `train_low_noise` both true → output pair `<name>_high_noise.safetensors` + `<name>_low_noise.safetensors`.
- Registry `needs_control_image: True` — image-only dataset may need control = the image itself. Verify in Task 2.
- Example config: `linear: 32`, `num_frames: 1`.
- Step checkpoints are `NAME_000005000.safetensors` (9 digits) → match with `/_\d+\.safetensors$/`, not `\d{6}`.

## Disk — blocker for G6

- `/opt/comfy/models` (147G): 113G used, **27G free**. `/` (97G): 58G free.
- 57 GB Wan base won't fit on the models volume. Owner picks at G6: grow the volume ($) or free space
  (candidates: `wan2.2_ti2v_5B_fp16` 10 GB, `miaomiaoHaremMOSS_baseV10_sdpa` 5.4 GB) or stage on `/`.

## ComfyUI nodes

- `CLIPLoader` has type `moss_image`; `VAEEncode`, `EmptyFlux2LatentImage`, `ReferenceLatent` exist.
- **But `MOSSImage.extra_conds` (comfy/model_base.py:2799) reads only `cross_attn` — `reference_latents` is ignored.**
  A ReferenceLatent pose edit does nothing on MOSS. Pose step = MOSS text-to-image + image LoRA (identity from the
  LoRA, outfit/pose from the prompt), fixed seed per set. If G7 shows drift, fallback is Klein 4B (has ref-latent
  support; download is an owner gate).

## Present models

- diffusion_models: miaomiaoHaremMOSS_baseV10_sdpa, pornmasterMoss_v1, smoothMixWan2214BI2V_i2vV20High/Low, wan2.2_ti2v_5B_fp16
- text_encoders: qwen3.5_9b_int8_convrot · vae: flux2-vae, wan_2.1_vae, wan2.2_vae
