# ComfyUI tab (GPU engine + Photo / Video / Library) — Design

> Brainstormed with the owner 2026-10-17. Piece 1 of 2: this design covers the rented-GPU engine and the general-purpose ComfyUI tab. Piece 2, the **Sprites studio** (platformer-style mascot animation, sprite-gen-style pipeline on this engine), is a separate design that comes after this one ships. After that come the sprite fixes, the animation fixes and the Chat-portrait wiggle fix. Parked sub-project B (bulk sprites, bodies) waits behind all of that.
>
> References studied (ideas only, no code copied):
> - **ComfyUI** (GPL-3.0). Runs as its own server on the GPU; the app only calls its HTTP/WS API, so app code stays ours.
> - **Locally Uncensored** (AGPL-3.0). Borrowed: generation modes, the LoRA stack with per-LoRA strength, the model picker reading the folder live, and the gallery.
> - **aldegad/sprite-gen** (Apache-2.0). For piece 2.
> - **Project Doppelganger**. Only the Hyperstack account access and the pod lessons are reused; its app, queue and NAS deployment stay separate.

## Why
NovelAI's free tier is capped (≤1 Mpx, ≤28 steps, one model family, no LoRAs, no video). The owner wants:
- a second generation engine with **more fine-tuning control**, **models chosen at will**, **LoRAs**, a **posing tool** and **uncensored video**;
- all of it running on **our own rented GPU**, never on Grok, OpenAI or other hosted providers that refuse NSFW or bill per call.

The first real use is a test: make a Miyabi-like character in Photo, then animate her in Video. Those clips are also the proving ground for the Sprites studio.

**Success:** from the phone, open the tab, write a prompt while the GPU warms, generate a posed Miyabi with LoRAs, animate her into a smooth 60 fps loop, and find both in Library. All of it without touching a terminal or a provider console.

## Goals
- A new app tab, **ComfyUI**, with sub-tabs **Photo · Video · Library**. The **Sprites** sub-tab arrives in piece 2; leave room for it.
- **Photo:** text-to-image with full control (model, LoRA stack, pose, sampler settings).
- **Video:** animate an image (main mode), text-to-video, extend a clip, seamless loop, and smoothing to 60 fps.
- **Library:** everything made in this tab, photos and clips.
- A **GPU engine** that rents and manages one Hyperstack VM running ComfyUI. The owner's choices for it:
  - pre-warm when the tab opens;
  - a long idle window;
  - a "keep warm until…" toggle;
  - a 48 GB card by default, with an H100 boost switch for heavy video.

## Non-goals (this piece)
- **Sprites studio** (piece 2): pose-driven walk, run and jump cycles, background removal, atlas building, curation, saving to the mascot.
- **Other modes:** audio/music, 3D, LoRA training (Character Studio), talking-character lipsync, inpaint/edit and background removal as user-facing modes. Leave space in the mode row, but don't build them.
- **Multiple GPUs at once or a job farm.** One VM, one queue.
- **Running ComfyUI on the Mac mini.** Too slow for video; there is one engine, and it is the rented GPU.
- **Changing the NovelAI Studio tab.**

## Anti-goals (a failure even if it technically works)
- **A GPU left running and billing without the owner knowing.** Every running minute must be visible in the tab, and every path must end in the VM being stopped or deleted.
- **Calling any hosted generation provider.**
- **A wall of ComfyUI nodes.** The owner never sees a node graph; the app owns the workflows.
- **Slow first use** because the tab waits for the GPU before letting you write a prompt.
- **Committing or printing secrets:** the Hyperstack API key, the Tailscale auth key, and the HF/Civitai tokens.

## Constraints
- **App stack:** Next.js 16 + better-sqlite3 + Tailwind v4, deployed on the Mac mini under launchd. The phone reaches it over Tailscale. Tests use node:test via tsx.
- **Night Studio design tokens** and all five themes must work.
- **New env vars** go in `studio/.env` (gitignored) and are read through `src/lib/env.ts`. Never log their values.
- **No real money is spent during development** without the owner's explicit go-ahead for that specific run. The first live VM start is a supervised step with the owner.
- **Hyperstack API:** `https://infrahub-api.nexgencloud.com/v1`. Endpoints, as Doppelganger's adapter uses them:
  - `/core/flavors`, `/core/environments`, `POST /core/virtual-machines`, `GET /core/virtual-machines/{id}`;
  - `/hibernate`, `/hibernate-restore`, `/start`, `DELETE`.
- **Hyperstack facts:**
  - A plain stop (SHUTOFF) **still bills the GPU**; only hibernate or delete stop billing.
  - hibernate-restore only works from HIBERNATED, not from HIBERNATING.
  - VMs are region-scoped environments, and every VM needs `key_name`.
  - Image: "Ubuntu Server 22.04 LTS R570 CUDA 12.8 with Docker".
- **ComfyUI must run with `--disable-cuda-malloc`** on these VMs (Doppelganger live fix).
- **Licences:**
  - ComfyUI is GPL-3.0. Run it unmodified as its own process; don't vendor it into the app.
  - Locally Uncensored is AGPL-3.0. Ideas only.
  - Some models are non-commercial. This is a personal app; record each model's licence in the manifest.

## The decided parts (owner)

### Layout: "canvas + drawer" (option C)
- The result image or clip fills the screen.
- Under it sits a row of tool chips.
- Tapping a chip opens a drag-up drawer. The drawer always holds the prompt and the Generate/Animate button, plus the tapped tool.
- At the top is a **GPU status line**, for example "● L40 warming… 40s" or "● L40 ready", with the boost switch and a running time/cost.
- Mockups: `.superpowers/brainstorm/*/content/photo-layout.html`, `pose-tool.html`, `video-tab.html`.

### Photo sub-tab
- **Model:** a picker over the checkpoints installed on the GPU's disk.
- **LoRA:** a stack. Add or remove LoRAs, with a strength slider each. The list comes live from the GPU's LoRA folder.
- **Pose** (owner: "B and editable with A"):
  - Start from a reference: a camera-roll photo or any Library/gallery image.
  - The engine extracts its pose. The extraction can also offer depth or outline.
  - The extracted stick figure appears over the canvas, and you **drag its joints to adjust**.
  - Settings: a strength slider, mirror, reset, and **save pose** for reuse.
- **Tune:** NovelAI's precise controls (seed, steps, CFG, sampler, size), plus scheduler, negative prompt and an optional hi-res second pass. *(My call on the extras.)* **No free-tier caps here:** steps and size go as high as the model sensibly allows.

### Video sub-tab
- The same canvas-and-drawer shape. Chips: **Model, LoRA, Motion, Tune**.
- **Modes:**
  - **Animate image** (default). The start frame is the last Photo result or any picked image.
  - **Text → video.**
  - **Extend clip:** continue from a clip's last frame.
  - **Loop:** the end frame equals the start frame.
- **Motion drawer:** length (seconds), motion amount, **smooth to 16 / 30 / 60 fps** (frame interpolation on the GPU), seamless loop on/off, end frame (same as start, or pick one), and size (480p / 720p).
- **Before Animate:** a line showing **estimated time and cost** for the current card.
- **General purpose.** Mascot-specific tooling belongs to piece 2.

### Library sub-tab
- Every photo and clip made in this tab, newest first.
- **Each item keeps its full recipe:** model, LoRAs, pose, settings, seed and the start frame. Tapping "reuse" loads it back into Photo or Video.
- Photos can be sent to Video as a start frame.

### The GPU engine (owner choices)
- **One Hyperstack VM** running ComfyUI, reused across sessions. Not a fresh VM per job.
- **Default card:** 48 GB (L40 / RTX A6000 class, whichever is in stock and cheapest).
- **Boost switch:** moves to an H100 80 GB for heavy video, and switches back afterwards.
- **Pre-warm:** opening the ComfyUI tab starts or wakes the VM in the background. You can write and tweak while it warms, and Generate queues until it's ready.
- **Long idle window:**
  - Default 45–60 minutes with no jobs, then the VM stops billing (hibernate or delete; see the builder's choices below).
  - A **"keep warm until…"** toggle overrides the idle window up to a chosen time.
- **Models on a persistent disk** attached to or kept with the VM, so a wake-up is "boot + load". Re-downloading every time is ruled out.
- **Costs Doppelganger's 10–12 minute idle stop doesn't have:** a slower first start, and possibly a small storage fee while the VM is stopped. The owner accepted those.

### Where models live
- The rented GPU can't read the NAS quickly (it would mean the home uplink every time).
- **The GPU's persistent disk is the working copy.** Models download straight from their sources (Hugging Face, Civitai) at datacenter speed, driven by a **manifest** with sha256 checksums (the Doppelganger pattern).
- **The NAS keeps the master library and backups:** private LoRAs and any model whose source might vanish. A NAS file is uploaded to the GPU once and then lives on its disk.
- The NAS is not mounted on the Mac mini today. How the app reaches it is part of the engine work (SMB mount, or upload from the phone/Mac through the app).

### First models *(my call, for the Miyabi test)*
- **Photo:** one SDXL-family anime checkpoint with strong LoRA support (Illustrious/NoobAI line), plus a pose ControlNet and preprocessors (DWPose/OpenPose, depth, lineart).
- **Video:** Wan 2.2 image-to-video 14B, fp8 on the 48 GB card. Plus first/last-frame support for loops.
- **Frame interpolation:** RIFE.
- **Custom nodes:** only what these need. Pin each to a version.

### Spending limits (owner)
- **Development budget, capped:**
  - The owner pre-approved a block of **$20 total** of live GPU time for building and testing (the figure is the example from the question; the owner can change it).
  - Every live run has a time limit, and the VM auto-deletes at a deadline.
  - The builder tests each piece as it's built and reports every run with its cost.
  - Going past the cap needs a new go-ahead.
- **Hard limits in normal use: daily cap, in-app warnings only.**
  - A **daily dollar cap**, default $10, forces a stop when reached.
  - **"Keep warm until…"** is capped at 6 hours.
  - Both defaults can be changed in Settings.
  - Warnings appear in the app only. There's no push alert or extra app. If a stop call fails, the server-side watchdog keeps retrying, and the tab shows a loud "GPU still billing" banner until it succeeds.

### Calls made after the builder check (mine; the owner can override)
- **Credentials:**
  - Reuse Doppelganger's Hyperstack API key and SSH `key_name`, copied into `studio/.env` under new names.
  - The VM joins the tailnet with an ephemeral key under a **new tag** (e.g. `tag:comfy-pod`). One ACL rule lets the Mac mini reach ComfyUI on it. The owner applies, or approves, that tailnet policy edit; nothing is changed without asking.
- **Pod image:** no GHCR build from the Mac mini (wrong architecture). The VM builds or installs pinned ComfyUI and custom nodes itself on first boot via cloud-init, and caches the result on its persistent disk, so later wake-ups skip the build.
- **Miyabi test uses public models only:** the manifest checkpoint plus a Miyabi LoRA from Civitai. The NAS link is not on the critical path; it comes in a later task (SMB mount or upload through the app).
- **H100 boost:**
  - A manual switch. It means a **second VM** in the **same region** as the persistent disk.
  - It stays on until turned off or the idle window ends, then the next job runs on the 48 GB card again.
  - If no H100 is in stock in that region, the switch shows "unavailable". No second model disk is kept in another region.

## What's left to the builder
- **How "stop billing" works for a reused VM.** Hibernate/restore (Doppelganger's way; slow to restore) versus delete + recreate with a persistent volume. **Measure both** once with the owner present and pick the faster wake-up. Persistent volumes on Hyperstack are region-bound, so the region choice has to follow.
- **How the app reaches ComfyUI.** Doppelganger's pattern is the VM joining the tailnet with an ephemeral, tagged auth key, and ComfyUI never being exposed publicly. Keep that unless there's a simpler safe option.
- **Pod image:** extend Doppelganger's `pod/Dockerfile` + `entrypoint.sh` approach or write a slimmer one. The ComfyUI version must be pinned.
- **Workflow storage:** keep workflow JSON in the repo as templates. The app fills in the node inputs; there's no free-form graph editing.
- **Job flow:** submit via ComfyUI `/prompt`, track progress via `/ws` (show percent in the drawer), fetch via `/view`, then store in the app.
- **Cost meter:** price per hour from Hyperstack's flavors/pricing at start time × running time. Show it live in the status line. A per-day running total is a nice-to-have.
- **Safety net:** a server-side watchdog (not only the open tab) that enforces the idle window even if the phone is closed. On app restart, reconcile with Hyperstack's VM list so an orphaned VM is never left billing.
- **Schema:** new tables for comfy generations and the engine state, alongside the existing ones in `studio.db`. Files go under `data/` (gitignored), separate from the NovelAI gallery.
- **Tab placement and icon** in `src/lib/tabs.ts` and the Liquid Island nav.
- **Exact time/cost estimate method** (a lookup table per model, size and length is fine).
