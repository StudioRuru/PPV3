# Sprites Studio — Animated Miyabi (Chat expressions, Stage companion, Mac overlay)

Date: 2026-10-17 · Status: draft for owner approval
Repo: `NAIPromptAgentV2`, app in `studio/` (Next.js). GPU side: the existing ComfyUI tab engine (`studio/src/lib/comfy/`) on the Hyperstack A6000 "main" pod.

## 1. Intent

Miyabi (the studio mascot) currently swaps between static sprites: expressions crossfade or pop, and the idle "life" is a CSS-style warp. The owner wants her to feel alive:

- **Chat portrait:** expressions blend through real animated transitions, and each expression has a generated idle loop.
- **Stage:** she becomes a *desktop-companion* character — bratty, erotic, knows she's hot and teases for the user's attention — moving through a library of full-body poses.
- **Mac overlay:** the same companion living on the owner's actual Mac desktop, above other windows.
- **Sprites studio:** a desktop-first editor where all of this is generated on our own ComfyUI GPU, reviewed, and extended with new poses/variants.

Prior art the owner pointed at: aldegad/sprite-gen (pipeline shape), but run on our own GPU, not Grok/OpenAI.

## 2. Goals, non-goals, anti-goals

**Goals**
- Animated mood-to-mood transitions on Chat, **direct** (A→B), not routed through neutral.
- A seamless 2–3 s generated idle loop per expression and per pose, **replacing** the warp entirely.
- Coverage for **all outfits (day, night, lewd) and all pairs**, produced as a background bulk job.
- Stage pose library + pose graph + behaviour engine, shared by the in-app Stage and the Mac overlay.
- The studio can add/create new poses and variants, not just regenerate the starter set.

**Non-goals**
- 2D-platformer walking/running cycles, side-scrolling movement.
- Real-time (per-frame) generation on device. Everything is pre-rendered clips.
- Replacing the Chat tab's model/voice (E4B mascot) — the companion reuses it for quips.

**Anti-goal (the failure even if it "works")**
- **She stops looking like Miyabi.** Identity drift across expressions, poses, outfits or within a clip is the primary failure. Every pipeline choice below serves identity first.

## 3. Owner decisions (as decided)

| Topic | Decision |
|---|---|
| Picture | Smooth idle/emotes, not walking around |
| Problem today | Expressions should blend smoothly (no crossfade/pop) |
| Transitions | Direct mood-to-mood clips |
| Scope | All outfits, all pairs, background bulk job |
| Idle | Generated loop per expression, replaces warp |
| Surfaces | Chat portrait + Stage, plus a Mac desktop overlay ("Both") |
| Endpoints | Real approved sprites; Wan fills the in-between |
| Takes | Several takes per clip; owner picks one or rejects all |
| Location | Sprites sub-tab in the ComfyUI tab (Photo · Video · Sprites · Library); old Settings sprite studio links there |
| Consistency | Qwen Image 2.1 editing: derive endpoints from one base image (owner's workflow, see §5) |
| Review | Grid per outfit |
| Stage | Has its own poses (not expressions) |
| Stage personality | Bratty/erotic desktop companion, teases for attention |
| Starter poses | standing; looking in different directions; facing different directions; checking nails; sitting; squatting; stretching legs; lying down; a few feminine poses |
| Extensible | Studio can add/create more poses and variants |
| Editor | Full-fledged editor on Mac is fine/preferred |
| Behaviour | Proposed set (§7) accepted as-is |
| Delivery | One design covering everything, built together |

Standing content rule: Miyabi is an adult character. **Do not add age-related wording or adjust negative tags for age.**

## 4. Architecture overview

```
 base sprite (per outfit, Chat bust + Stage full-body)
        │  Qwen 2.1 edit (TextEncodeQwenImage21 + image_1)
        ▼
 endpoint images: expressions (Chat) / poses (Stage)   ── owner approves
        │  Wan 2.2 first/last-frame (Smooth Mix i2v)
        ▼
 clips: transitions A→B, idle loops (first = last frame)
        │  background removal on every frame, encode with alpha
        ▼
 review grid (takes) ── owner approves ──► mascot clip library (server)
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    ▼                          ▼                      ▼
             Chat portrait player       in-app Stage player     Mac overlay app
                                        (behaviour engine, shared rules)
```

One **clip engine** (two images in → reviewed, approved, transparent clip out) is built first and is reused by every surface. It runs as jobs on the existing ComfyUI tab job queue/engine (pod start/hibernate, idle stop, cost estimates, persistence all already exist).

## 5. Generation pipeline

### 5.1 Endpoints via Qwen edit (identity lock)
- Qwen Image 2.1 edits natively through ComfyUI's built-in `TextEncodeQwenImage21`, which takes `images.image_1..7` + `vae` alongside the prompt. Our Photo graph already uses this node (`studio/src/lib/comfy/recipe.ts`, text-only); editing = wiring `image_1` (the base) and the VAE.
- Owner's reference workflow (civitai.red model 2965021, "Turbo AIO", read-only in scratchpad): stock `qwen_image_2.1_turbo` (int8), `qwen3vl_8b` text encoder, `qwen_image_2.1_vae_bf16`, CFG 1, `euler`, ManualSigmas 8 steps `1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0`. KJNodes/rgthree/Sage Attention in it are conveniences and not required.
- Flow: owner picks/approves **one base image per outfit per surface** (Chat bust, Stage full-body). Each expression/pose endpoint = base + an edit instruction ("same character, same outfit, same framing; <expression/pose>"). Owner approves endpoints before any clip is generated.
- Stage poses change the whole body, which is harder than expression edits. Builder may add DWPose/depth ControlNet guidance (already on the pod) if Qwen edit alone drifts. Validate early (§11).

### 5.2 Clips via Wan first/last frame
- Model: Smooth Mix Wan 2.2 14B i2v High/Low (on the pod; 8 steps, CFG 1), first/last-frame conditioning.
- **Transition** A→B: first frame = endpoint A, last frame = endpoint B. Chat transitions short (< ~1 s); Stage pose transitions ~2–3 s.
- **Idle loop:** first frame = last frame = the endpoint, 2–3 s, seamless (we measured loop-seam SSIM 0.96 earlier).
- RIFE interpolation to a smooth playback fps (existing graph supports it).
- **Takes:** N takes per clip with different seeds (default 3). Rejected cells re-queue with new seeds.
- **Reverse-play shortcut (builder's call, verify):** for Chat, one A→B clip may be played backwards for B→A, halving the count. Only use if reversed clips look natural on review; otherwise generate both directions.

### 5.3 Post-processing
- Background removal on every frame (BiRefNet or equivalent; custom node on the pod or server-side), producing alpha.
- Encode with alpha in a format iOS Safari and the Mac overlay both play smoothly (animated WebP vs. WebM/HEVC-with-alpha — builder measures and picks; may store two encodes if needed).

### 5.4 Volume and cost (estimate)
Chat ≈ 8 expressions → 28–56 transitions + 8 idles per outfit; Stage ≈ 12+ poses on a sparse graph (~20 edges) + 12 idles per outfit; × 3 outfits × 3 takes ⇒ several hundred clips. At measured A6000 rates (~$0.50/hr; i2v ~2.5 min per 5 s clip, shorter clips cheaper) this is a few dollars and a few hours of background GPU time. The UI shows an estimate before a bulk job starts, using the existing estimator.

## 6. Data model (shape, builder finalises)

- **Outfit**: day | night | lewd (+ owner-added variants).
- **Surface**: chat | stage.
- **Endpoint**: (surface, outfit, key) → approved image. Chat key = expression; Stage key = pose.
- **Pose graph** (stage, per outfit or shared): nodes = poses (with tags like `tease`, `rest`, `lewd`, `reaction`), edges = allowed transitions. Not every pose connects to every other (e.g. no lying→standing direct).
- **Clip**: (surface, outfit, from, to) with `from == to` meaning idle loop; status `empty | queued | generating | review | approved | rejected`; takes; the approved take; seeds/recipe for reproducibility.
- Library lives server-side with the mascot data; surfaces fetch the approved set. Writes only from the studio.

## 7. Behaviour engine (Stage + Mac overlay)

Accepted as proposed. One rule set, two hosts.

- **Left alone:** every 20–60 s drift to a linked pose (look around, check nails, sit, stretch). On Mac she stays near a screen edge / the Dock, not over work.
- **Ignored a while (~5 min):** bratty escalation — turns to face the user, feminine pose, lies down stretching with a pout; longer ignore ⇒ bolder poses. Lewd poses only when the lewd outfit is active.
- **Poke (click/tap):** short reaction (flustered/smug); repeated pokes ⇒ a "make me" tease.
- **Drag (Mac):** dangle/held pose while dragged; settles into a sit where dropped.
- **Activity (Mac):** glances toward the cursor on typing bursts; Mac idle ⇒ lies down and sleeps; user returns ⇒ wakes with a "finally" tease.
- **Talk bubble:** optional one-line quip per reaction, generated by the existing E4B mascot model so her voice matches Chat.
- **Controls:** boldness setting (tame / teasing / lewd) gating which poses the engine may pick; hide; mute bubble.
- Movement between poses always follows graph edges via approved transition clips; if a needed clip isn't approved, fall back to the current crossfade.

## 8. Surfaces

### 8.1 Sprites studio (editor)
- Sub-tab in the ComfyUI tab; the Settings sprite studio links to it.
- **Desktop-first** wide layout in the existing web app (used in the Mac browser); phone layout stays usable for quick approve/reject. (No separate native editor.)
- Views:
  - **Bases & endpoints:** per outfit/surface, pick the base, generate endpoints by edit, approve/reject/regenerate each.
  - **Grid per outfit (review):** Chat = from-expression rows × to-expression columns, diagonal = idle loops; Stage = clips listed per graph edge plus idles. All cells loop simultaneously so drift stands out. Cell status shown. Click a cell → takes side by side → pick one or reject all.
  - **Pose graph editor:** add a pose (describe it → Qwen edit from base → approve), connect/disconnect edges by dragging, tag poses (`tease`, `lewd`, `rest`, `reaction`…), then "generate missing" fills its idle + edge transitions.
  - **Bulk job control:** "generate everything missing" per outfit/surface with cost estimate, progress, pause/cancel; runs in the background via the existing job queue.
- Approved clips go live immediately, cell by cell.

### 8.2 Chat portrait
- Player shows the current expression's idle loop; on mood change plays the approved direct A→B transition, then B's idle loop.
- Missing clip ⇒ existing crossfade. Mood change mid-transition: builder's call (finish-then-chain or cut to the new transition), must not flash or show a blank frame.
- Replaces the warp idle. Also fixes the known portrait wobble / blink pop (the blink lives inside generated idles now).

### 8.3 In-app Stage
- Full-body player driven by the behaviour engine (§7) minus Mac-only signals (drag across screen, system idle, menu bar).

### 8.4 Mac overlay app
- Small native macOS app: transparent, borderless, always-on-top window showing Miyabi; click-through except over her own pixels; draggable.
- Fetches the approved clip library + pose graph from the studio server (local / over Tailscale), caches it locally, works offline from cache.
- Menu-bar item: show/hide, boldness, mute bubble, outfit, quit.
- **Hide automatically during screen sharing/recording** (builder's call on detection method).
- Talk-bubble quips via the studio server's mascot endpoint.

## 9. Constraints

- GPU: existing Hyperstack A6000 main pod and the ComfyUI tab engine; no new cloud providers. Any new model downloads go on the persistent models volume and through the manifest (`studio/pod/comfy/models.manifest.yaml`) with sha256.
- Model searches/downloads from civitai.red (or Hugging Face for Comfy-Org repacks).
- Do not spend GPU money or Anlas without the owner's go-ahead; bulk jobs show an estimate and require confirmation.
- Never print secrets (.env, tokens, keys).
- Live studio (launchd `com.philly95.naistudio`, :3000/:3100) is only touched by approved deploys; dev testing uses a scratch DB copy.
- No age wording in prompts; don't alter negatives for age.

## 10. Left to the builder

- Exact storage layout, clip encoding format(s), API routes, file naming.
- Background-removal model/node choice and where it runs (pod vs. server).
- Whether Noct Q (our Qwen 2.1 fine-tune) edits well enough or the stock Qwen 2.1 Turbo model must be added to the manifest (§11 decides).
- Reverse-play shortcut on Chat (§5.2).
- Mid-transition interruption policy (§8.2).
- Mac overlay tech (Swift/AppKit preferred for a transparent always-on-top window), packaging/signing for the owner's Mac.
- Screen-share detection method.
- Behaviour timings beyond the numbers in §7.

## 11. Risks and first validation (needs owner GPU go-ahead, ~$0.10–1)

1. **Qwen edit identity:** edit the Chat base into 3 expressions with Noct Q; if drift, repeat with stock Qwen 2.1 Turbo. Pass = owner says "that's still Miyabi".
2. **Full-body pose edits:** same test for 3 Stage poses (sitting, lying, checking nails); add DWPose ControlNet if needed.
3. **Wan FLF transition + idle seam** on approved endpoints, with background removal, played in iOS Safari and a prototype transparent Mac window.

Build order inside the single design: clip engine + Qwen edit endpoints → review grid → Chat player → pose graph + behaviour engine + Stage → Mac overlay.

## 12. Calls I made (not owner-decided)

- Desktop-first web editor rather than a native Mac editor; only the overlay is native.
- Approved clips go live per cell; missing clips fall back to the current crossfade.
- Sparse pose graph rather than all-pairs on Stage; Stage transitions 2–3 s.
- Hide on screen share; default 3 takes per clip.
- Builder-check answers (§13).

## 13. Builder-check answers

1. **Endpoints:** Qwen-edited from one base per outfit/surface (owner decided the Qwen identity-lock approach). Existing Miyabi sprites are *base candidates*: the owner picks one existing sprite per outfit as the base; if no full-body sprite suits the Stage, the studio generates a Stage base with the Photo pipeline and the owner approves it. Existing expression sprites are not reused as endpoints directly (my call: mixing old and edited endpoints reintroduces drift).
2. **Inventory:** user-extensible (owner: "customizable to add or create more variants"). Outfits, expressions and poses are data rows, not enums; day/night/lewd and the current expression set are seeded from the existing mascot data. Grid scrolls; no pagination needed at this scale.
3. **Wan first/last frame:** the Video recipe already carries `start`/`end` item ids (`studio/src/lib/comfy/recipe.ts`, `VideoRecipe`) on the Smooth Mix i2v graph — extend that graph/pattern rather than authoring a new one; idle loop = `start == end` (the existing `loop` mode).
4. **Validation gate:** not a hard stop for building. Build the clip engine, review grid, players, behaviour engine and overlay against mock/sample clips; §11 validation runs when the owner approves the GPU spend, and gates only the **bulk generation**, not the code (my call).
5. **Overlay auth:** the studio already has optional app-password auth (`studio/src/middleware.ts`, session cookie). The overlay logs in through `/api/auth/login` with the password the owner types into the overlay's settings once, keeps the session in the macOS Keychain, and only calls read endpoints (library + pose graph) and the quip endpoint. No new token system (my call).
6. **Storage:** clip library on the studio host disk under the existing data directory. Keep approved takes plus recipe/seed; delete rejected/unpicked take files once a cell is approved (recipe + seed stay for reproducibility). Studio shows library size (my call).
