# Reliable GPU + Scene Assistant — design (2026-11-19)

One sprint, two tracks. Track 1 ships first: the assistant is only useful if pressing Start reliably ends with a ready ComfyUI.

## Why

- **Owner's words:** "we still need to improve how the app can launch, power up the gpu, and run these models more consistently."
- **Owner's words:** "add a chat function where one of our models can infer user basic text into a scene that these models can understand. Especially with video structure. A prompt assistant meant for photo, anime and video."
- The studio is used from the phone over the tailnet. Today a failed start shows up as a vague stuck phase, and the only fix is Stop/Flush and trying again.
- Writing a good prompt also means knowing each model family's dialect (Danbooru tags, natural language, or timed video beats). The assistant does that translation.

## Evidence (server.log + studio.db, Oct–Nov)

| Failure | Count / where | Root cause |
|---|---|---|
| Volume detach 426 "VM is not suitable… only ACTIVE, SHUTOFF" | 426, VMs 1110327 / 1119741 / 1131338 | `hs.hibernate` detaches without checking VM state, and it's retried every tick |
| Attach 400 "There are already attached Volumes" | recurring | treated as failure; it is success |
| "RESTORING before the models volume attached" | recurring | `attachWhenActive` throws on a non-ACTIVE transitional state instead of waiting |
| hibernate-restore 400 "not suitable" | recurring | restore called while VM in a transitional state |
| Model sync "Could not resolve hostname nai-comfy-main" | 22× | `syncModels`/`releaseModels` ssh by MagicDNS name; flushed pods leave a stale node, so the new one is `nai-comfy-main-1` (`tailnetIp` already handles this; sync doesn't use it) |
| SSH port 22 timeout | several | sync fired before sshd/tailscale was up; no wait or retry |
| 404 on `krea2Softrealism_v10.safetensors` URL | Krea2 start | manifest URL died; nothing checks links before a paid start |
| Restarts clustered (4 runs on Nov 5) | comfy_runs | owner retrying by hand after the above |

## Track 1 — Reliable GPU launch

### Goals
- Start → ready without manual retries in the normal case.
- When a step does fail, the phone shows **which step** failed, in plain words, with a **Retry this step** button. No Flush needed.
- No paid minutes burned on a start that was always going to fail (dead model link).

### Non-goals
- Changing GPU provider, card types, or spend policy (WARM_MAX_MS, budget stop) — untouched.
- Auto-recovering a RESERVED volume (still needs Hyperstack support; keep the existing 409 message).

### Anti-goals
- Any change that could leave a VM billing while the UI says off. Billing safety beats every other rule here, as today: an unreachable pod still hibernates.
- Retry loops that hammer the Hyperstack API (the 426 storm is exactly this).

### Design

**1. State-aware volume ops** (`hyperstack.ts`)
- `detach`: only call when status is ACTIVE or SHUTOFF. Otherwise wait (poll with the existing `pollMs`, bounded by the existing restore wait). If it never gets there, **hibernate anyway** (billing wins, per the anti-goal) and raise an alarm on the view naming the RESERVED-volume risk. The wait runs **outside the per-card tick lock** (background, like `attachWhenActive` today), so one slow detach doesn't freeze that card's ticks (my call). Never log the same failure per tick: one line per VM per operation.
- `attach`: a 400 "already attached" counts as success.
- `attachWhenActive`: transitional states (RESTORING, HIBERNATING, BUILD, etc.) mean keep waiting. Only ERROR, gone, or timeout throw.
- `restore`: wait out a transitional state before calling. Don't fire it and eat the 400.
- Unit tests for each rule against the existing fake in `hyperstack.test.ts`.

**2. Sync by tailnet IP, after SSH is up** (`pod.ts`, `engine.ts`)
- `syncModels` and `releaseModels` take a host. The engine passes `addr.get(card)` (resolved via `tailnetIp`), falling back to `podHost(card)` only if no IP is known yet. Same for `loras.ts` and `train.ts` callers that build `root@${host}`.
- Before syncing, wait for SSH: a probe like `ssh -o ConnectTimeout=10 true`, retried with backoff (5 s → 10 s → 20 s → 40 s, capped, total ≈ 3 min).
- Sync itself retries twice with backoff on SSH/network errors, but not on download errors (those are a link problem; see 3).

**3. Model link preflight + mirror**
- **What blocks:** every manifest entry for the card is required. No new schema field (my call; add an `optional` flag when a real optional file shows up).
- **Preflight:** before a start (not before every tick), HEAD each manifest URL for the card's entries that aren't on the volume (see below), following redirects with the HF/Civitai tokens. A dead *required* file blocks the start with a plain message ("Krea2 checkpoint link is dead — fix the manifest"). Cache a good result for 24 h so a normal start adds no delay.
- **Mirror (my call):** the main card's models already live on the persistent 150 GB volume. That volume *is* the mirror. `fetch-models.sh` already skips files whose size/sha match, so a dead upstream link only matters for files not yet on the volume. The preflight therefore only checks entries **missing from the volume**. The volume is detached while hibernated, so the engine **saves the volume's file list (name + size) after every successful sync** and checks against that saved list before a start. That runs before any VM is billed (my call). No saved list yet (first start, or boost) means every entry is checked. That makes the check near-zero for a normal main start. No private HF repo this sprint. Add one later if boost-card starts (root disk, no volume) keep hitting dead links.
- Fix the Krea2 manifest URL as part of this work.

**4. Launch checklist** (engine view + `GpuLine.tsx`)
- Steps, matching how the engine already behaves: **Links** (preflight) → **GPU** (VM created/restored → ACTIVE) → **Disk** (models volume attached + mounted; main only) → **Network** (tailnet IP found, SSH answers) → **ComfyUI** (HTTP 8188 answers) → **Ready**, then **Models** (background sync) as a trailing step.
- **Ready does not wait for the sync** (my call). That keeps today's phase rules, job dispatch and idle timer (`lastActivity` at ready). The Models step stays visible after Ready until the sync finishes. A failed sync shows its error with Retry, and the card stays Ready.
- Models is done/not-done, plus a "fetched N files" count parsed from the sync's output when it returns. No live streaming (my call; add it if first-boot fetches feel opaque).
- Each step records start time, end time, and a short error. They live in the engine's in-memory state and go out on `EngineView` (no new DB table; a server restart mid-start shows the step the reconcile tick lands on).
- UI: while starting, the GPU line expands into the checklist with a tick/spinner/cross per step and elapsed seconds. On failure: the plain error and **Retry this step**, which re-runs from that step without recreating the VM. Collapses back to the normal line when ready.
- `EngineAction` gains `{ action: "retry"; step }`.
- Plain-error mapping lives in `view.ts` next to `alarmText`, with tests.

### Done when
- The unit tests for 1–3 pass.
- One real start from hibernated main on the phone shows the checklist end-to-end.
- A forced failure (e.g. a bad manifest URL in a scratch copy) shows the plain message and blocks the start before the VM is billed.

## Track 2 — Scene Assistant

### What it is
A chat inside the Comfy tab. The owner types plain text ("she's sitting on a rooftop at night, then stands up and the wind catches her hair"). The assistant replies with a model-ready prompt for the chosen target, plus LoRA suggestions, and one tap sends it into Photo or Video.

### Goals
- Plain text → a prompt in the target model's own dialect:
  - **Anime** (Illustrious/WAI, `sdxl` family): Danbooru tags in the order the `/prompt` skill uses, following the emphasis budget (`{{}}` on 1–2 tags, `{}` on 3–6, the rest unweighted). Tags checked against the local Danbooru CSV; unknown tags dropped or swapped for the nearest real one.
  - **Photo** (Krea 2 / MOSS, `krea2`/`moss`): natural-language prose. Subject first, then setting, lighting, camera and lens.
  - **Video** (Wan 2.2 now): a structured shot. Subject → setting → camera → **timed beats, one action per beat**, one beat per ~5 s segment, so it lines up with how `beats()` splits chained segments. The reply shows the beats as a list with their time ranges. The prompt it sends puts one beat per sentence, so `beats()` splits it exactly as shown.
- It suggests LoRAs from the installed list (`/api/comfy/loras` + `lora-info`) that fit the target family (`fits()`), with strength and trigger words, and inserts triggers through the existing `addTriggers`.
- Multi-turn: "make it raining", "slower camera", and "more explicit" revise the last prompt rather than starting over.
- **Send to Photo / Send to Video** fills the existing recipe through the same path Library "Reuse"/"Animate" use (`reuse()` / `animate()` in `ComfyScreen`).
- **Video needs a start frame (owner's answer: "Pick a start frame").** Wan only chains beats in i2v, so Send to Video opens a start-frame picker: a Library item or an upload (the existing `startImage` path). It then fills an `animate` recipe with the beats, and `seconds` is set to beats × ~5 s. This is picking an existing image, not describing one, so it doesn't conflict with the image-input non-goal. The recipe goes through `validatePhoto`/`validateVideo` before it lands, so a bad LoRA or size can't get through.
- Explicit content follows the owner's existing style defaults (dark arcs, max intensity by default). The assistant does not soften or refuse the owner's own scenes.

### Non-goals (deferred to next sprint)
- MiniMax H3 (talking video with audio) and Anima as targets. The target list is a small table, so adding them later is one entry each.
- Auto-generating on send. Send only fills the recipe; the owner still presses Generate.
- Image input ("describe this photo into a prompt") — the identify skill covers it outside the app.

### Anti-goals
- A second, divergent tag vocabulary. It must reuse the `/prompt` skill's tag library, themes and emphasis rules, not paraphrase them into a new prompt.
- Made-up LoRA names or trigger words. Only installed files with their real triggers.
- Replacing Miyabi's Photo copilot. That stays as is, for tweaking a recipe that already exists. The assistant is for writing one from nothing.

### Design (my calls, flagged)
- **Where (my call):** a new **Scene** sub-tab, first in the Comfy row (`Scene · Photo · Video · Sprites · Library`). It's a full chat surface, which the side copilot panel is too cramped for on a phone. The target picker (Anime / Photo / Video) sits at the top of the chat. The model picker defaults from the target: Anime → WAI, Photo → Krea 2, Video → Wan.
- **Which LLM (my call):** Gemma (`BRAIN_MODEL`, local, free, already the copilot brain) is the default. A picker offers Omega (`kobold:`) and Soji (`chub:`, once the proxy is up), reusing the `llm.ts` prefix routing. Heavy-gate rules apply as for RP.
- **Server:** a new mode in `copilot-prompt.ts` (`scene`), with per-target system prompts built from the skill references (`.claude/skills/prompt/references/*`, `data/themes/`), plus a route `/api/comfy/scene` that streams the reply. The model is asked for a fenced JSON block (`{ target, prompt, negative?, beats?: [{ from, to, text }], loras: [{ name, strength }] }`) after its prose. The server parses it, validates tags and LoRAs, and returns the cleaned recipe patch alongside the text.
- **Storage:** scene chats persist like Miyabi chats (one table, last N turns kept). Losing a well-built prompt to a reload would sting.
- **Tests:** tag-emphasis budget enforcer, beat/time alignment with `beats()` and `wanFrames()`, LoRA filter (family + installed only), JSON-block parser (malformed → text-only reply, no crash).

### Done when
- The owner types three plain scenes on the phone, one per target, and each sends into Photo/Video with a prompt they'd use as-is.
- A two-beat video scene generates as two chained segments whose actions match the shown beats.

## Constraints
- Next.js studio on the Mac, live on :3100. Don't build in the live directory; build only as part of deploy + kickstart.
- Secrets (Hyperstack key, tokens, Chub key) are never logged or sent to the client.
- Phone-first UI over the tailnet. Wide Mac layout must not break.

## Left to the builder
- Exact backoff numbers within the bounds above, and poll intervals.
- Checklist visuals (match the existing GpuLine style and the liquid-glass nav).
- How the pod reports what's on the volume (a file listing over SSH or a manifest-check script).
- System prompt wording, as long as it's sourced from the skill references.
