# NAI V5 Studio — Design Spec

**Date:** 2026-10-13
**Status:** Draft — awaiting user review
**Location:** `NAIPromptAgentV2/studio/` (replaces the dead `closet-ui/`, which has no source left)

## 1. Intent

**User said:** NovelAI is now on V5 Full; the system must keep working on it. Build an integrated
tagging + prompt app (inspired by @Swamp_AI_4th's Tagger+NovelAI app), fully usable from the
iPhone. A chat toggle turns on a local uncensored Ollama model that takes over what Claude does in
chat today: creation, scene building, themes, image tagging, tag clusters. UX polish is a
first-class phase. Optional native iPhone app via Xcode (sideloaded, not App Store). Claude
declines explicit content, so the app uses no Claude API: every AI role runs locally on
NSFW-capable, anime-trained models (§4.6). Claude stays available outside the app via the skills.

**Assumptions:** single user (owner only); runs on the Mac Mini (M4 Pro, 24 GB); `tags/*.yaml` and
`data/` remain the source of truth shared with the Claude skills.

**Success:** from the phone, anywhere on Tailscale, the user can tag a reference image, build or
chat-assist a V5 prompt, generate on `nai-diffusion-5-full`, run a one-axis strength grid, and save
results to the library — without opening novelai.net or Claude.

## 2. Reference: what V5 changed (drives the rules doc and skill updates)

- Model `nai-diffusion-5-full` (also `-curated`), host `image.novelai.net/ai/generate-image`
  (old `api.novelai.net` rejects the model). Body = V4 skeleton; prompt must appear in `input`,
  `parameters.prompt` and `v4_prompt.caption.base_caption`; missing `v4_prompt` /
  `v4_negative_prompt` → HTTP 500. Response = zip containing `image_0.png`.
- Token budget ~1471 effective (Full) vs 512 shared on V4.5 — current pruning rules are too tight.
- Natural language + Japanese first-class; tag position no longer a reliable strength lever.
  Numeric `w::tag::` and negative weights still work.
- New tags: `high complexity` (recommended default; also low/medium/ultra), `transparent background`,
  `has alpha`, `alpha transparency`, `depthness`, `meta:novel era`, `meta:golden era`,
  `visual novel cg/bg/sprite/chibi/art`, `attractive male`. Prefixes `fur dataset,`,
  `background dataset,`.
- Quoted text auto-builds the `Text:` block; multi-panel comic pages in one generation; up to 22
  characters with free canvas positioning.
- **Precise Reference and Vibe Transfer are NOT on V5 yet** → `/identify` style-recreation and the
  arc "scene-1-as-character-reference" workflow must say "use V4.5 for this step" until they ship.
- Opus free generations on V5 have a usage limit. 0-Anlas conditions: 1 image, ≤1,048,576 px,
  ≤28 steps, no base image. API terms: every generation must be initiated by a human action.

## 3. Architecture

```
iPhone (PWA now, native app later) / Mac browser — via Tailscale
        │
  Next.js app :3100 ── login gate (APP_PASSWORD, JWT cookie; from Delfino)
   ├─ /api/generate  → image.novelai.net (NAI token in server .env, never sent to client)
   ├─ /api/grid      → N sequential generations, fixed seed, one line's weight stepped
   ├─ /api/tag       → tagger sidecar :8190 (FastAPI: PixAI Tagger v1.0 + Camie v2 artist pass)
   ├─ /api/caption   → JoyCaption Beta One (vision: booru tags + natural-language caption)
   ├─ /api/expand    → TIPO v2.1 via Ollama raw completion (tags ↔ natural language)
   ├─ /api/chat      → Ollama brain model (scenes, themes, arcs, clusters)
   ├─ /api/library   → tags/*.yaml, data/{outfits,themes,arcs,clusters}/*.yaml
   └─ SQLite (better-sqlite3 + Drizzle): generations, chat history
   Files: data/gallery/*.png (recipe embedded by NAI)
```

Reused from Project Delfino Plaza (copied, not linked): Next.js 16 + Tailwind v4 + Drizzle setup,
Ollama streaming client, PWA manifest/service worker, auth middleware, `*.sh start|stop|status`
script + LaunchAgent pattern, `tailscale serve` recipe.

## 4. Components

### 4.1 Shared V5 rules — `v5-syntax.md`
One file at `.claude/skills/prompt/references/v5-syntax.md` (supersedes `v45-syntax.md` for V5;
V4.5 file kept for V4.5 use). Loaded by the skills AND injected into the chat system prompt, so
the Claude skills, Ollama and the app never drift. Skills `/prompt`, `/identify`, `/story` updated to target V5
by default: token budget, ordering guidance, new tags, Precise Reference caveat, natural-language
hybrid guidance.

### 4.2 Studio (prompt editor + generation)
- **Prompt model:** base = ordered list of lines `{text, weight?, enabled}`; serialized by joining
  with `, `, weighted lines as `w::text::`. Character boxes (≤22): lines + position
  (`AI decides` default, or canvas coords). UC block with presets from `negative-prompts.md`.
- **Rating switch** SAFE / NSFW / OFF: toggles rating tag in base + matching UC preset.
- **Autocomplete:** YAML DB + bundled Danbooru tag CSV (name, category, post count → knowledge
  dots) + V5-only tags list.
- **Params defaults:** 832×1216, 28 steps, scale 5, `k_euler_ancestral`, `karras`, qualityToggle
  off, random seed (lockable). Model picker: V5 Full / V5 Curated / V4.5 Full.
- **Generate:** build V5 body → POST → unzip → save PNG to `data/gallery/` → insert generation row
  (full request JSON, seed, model, path, created_at). History strip (newest first); tap → view,
  "Reuse recipe" (loads prompt/seed into editor; also works on any dropped NAI PNG via a TS port of
  `nai_meta.py` — tEXt/iTXt `Comment` + stealth alpha LSB).

### 4.3 Strength grid
Pick one line, weight range (min/max) and steps (3–6). Shows estimated cost first. Runs cells
sequentially on one fixed seed with ~2 s spacing (stays low-profile vs. the human-action rule).
Cells stream into a labeled row; tap a cell → that weight is applied to the line. Stops on first
error, keeps finished cells. Grid results are saved as normal generations tagged with a grid id.

### 4.4 Tagger
- Sidecar: FastAPI + Transformers on MPS. `POST /tag` (image) → every tag with
  `{name, category, score}`.
  - **Primary: `pixai-labs/pixai-tagger-v1.0`** (Apache-2.0, 0.5B, 30,877 tags, data to May 2026).
    Categories general / character / style / copyright / meta / rating (g/s/q/e). Default
    thresholds from its card: general 0.17, character 0.27, style 0.15, copyright 0.24, meta 0.17,
    rating 0.41 (the same values the reference app uses). Character micro-F1 0.92 vs Camie 0.73.
  - **Artist pass: `Camais03/camie-tagger-v2`** (GPL-3.0, personal use; 143M, ONNX). Only its
    `artist` (7,007 tags, 70% micro-F1) and `year` outputs are used, mapped to `artist:name` and
    `year 20XX`. Feeds the artist sliders/grid and stands in for style recreation while Precise
    Reference is missing on V5. Toggle, on by default.
- Candidate artist tags are checked against the Danbooru CSV before display (detections are
  guesses, not facts).
- UI: threshold slider per category (filtered client-side, no re-run), exclude list (default
  `watermark, text, signature`), underscores→spaces, strip escaped parens, sort by YAML category
  (appearance → clothing → pose → setting → other), tag count. Send to base / Character N,
  replace or append; optional auto-send after analysis. If the image carries an NAI recipe, show
  it alongside.

### 4.5 Library + clusters
Tabs: Outfits, Themes, Arcs, Clusters. Load → fills editor (arcs: pick scene). "Save as…" writes
YAML in the existing skill formats. Clusters = named tag groups in `data/clusters/<name>.yaml`
(`name, tags[], notes`), insertable as one line, usable by skills.

### 4.6 Chat co-pilot (local NSFW-capable model stack)
Each job goes to the model that is best at it, all local, all NSFW-capable:

| Role | Model | Why | Runs via |
|---|---|---|---|
| Tagging | PixAI v1.0 + Camie v2 (§4.4) | Purpose-built taggers beat any LLM at booru tags | tagger sidecar |
| Optical / scene read | `fancyfeast` **JoyCaption Beta One** (Llama-3.1-8B LLaVA; GGUF Q4 ~5 GB + mmproj, e.g. `mradermacher/llama-joycaption-beta-one-hf-llava-GGUF`) | Trained with equal SFW/NSFW coverage; has a stabilized "Booru tags" mode plus descriptive captions, which suits V5's tag + natural-language hybrid | Ollama if it imports cleanly, else `llama-server` (brew llama.cpp) on :8191 — confirmed by a spike at the start of phase 6 |
| Syntax / prompt expansion | **KBlueLeaf TIPO-v2.1-1B-A200M** (GGUF Q8 ~1 GB, Kohaku License) | Trained on Danbooru: expands short prompts, converts tags ↔ natural language, conditions on rating up to `explicit`, emits only real tags | Ollama, `raw: true` completion (GGUF has no chat template) |
| Brain: scenes, themes, arcs, clusters, conversation | `dolphin-mistral-24b` (installed) default; `cydonia-24b` switchable | Uncensored, already proven in Delfino | Ollama chat |

- Drawer, off by default. On → loads the brain with keep-alive; off → `keep_alive: 0`.
- **RAM rule (24 GB):** brain (~14 GB) and JoyCaption (~6 GB) are never resident together; the app
  unloads one before loading the other. Taggers + TIPO (~2.5 GB) may stay loaded.
- **Pipeline:** "Read this image" = taggers + JoyCaption caption → brain merges into a scene. "Expand"
  = TIPO on the current lines → brain only rewrites when asked. Brain output tags go through the
  same CSV/YAML check as everything else.
- **Context:** `v5-syntax.md`, current prompt state, keyword-retrieved YAML sections (not the whole
  DB), scene-style preferences.
- **Output contract:** prose + one fenced JSON block
  `{"ops":[{"target":"base|char:N|uc","action":"add|remove|replace|weight","line":"…","weight":1.15}]}`
  → rendered as a patch card with Apply / Discard. Before display every tag is checked against the
  CSV + YAML; unknown tags flagged.
- Quick modes: Create character, Build scene, Theme, Arc step, Cluster these tags. Tagger results
  can be sent to chat ("make this a scene").

### 4.7 Design pass (queued, own phase)
After functionality lands, a dedicated UX phase using the impeccable/frontend-design skills:
direction proposal + mockups reviewed by the user before applying; mobile-first layout (bottom tab
bar: Studio / Tagger / Library / Grid; chat as sheet), touch targets, loading/empty/error states,
dark theme default. No design work blocks earlier phases beyond basic usable layout.

### 4.8 Native iPhone app (optional, last phase, "if polish allows")
SwiftUI app built in Xcode 26 and installed directly to Ruruphone (team 9TL96DXFPC), talking to the
same `/api/*` over Tailscale. Starts as a native shell (tab bar, share-sheet "Tag this image",
photo-library save, haptics) hosting the web Studio in WKWebView; screens go fully native only where
the web version measurably falls short. No App Store submission.

## 5. Error handling
- NAI: 401 → "token invalid/expired"; 429 → "rate limited, wait"; 500 → "request rejected
  (often missing v4 prompt fields)"; network → retry button. No silent retries that spend Anlas.
- Tagger/Ollama/JoyCaption offline → banner, rest of app keeps working.
- Grid: abort on first error, keep finished cells.
- Saves are atomic (write temp + rename) so YAML is never left half-written.

## 6. Testing
One runnable check per non-trivial unit: prompt serialization → V5 body; patch-op applier; NAI PNG
metadata parser (fixture PNG); tagger threshold/sort filter; tagger sidecar smoke test (`/tag` on a
fixture image); one smoke call each to TIPO and JoyCaption. Plus one real end-to-end V5 generation and a phone run-through over Tailscale per
phase.

## 7. Phases (each usable on its own)
1. V5 rules doc + skill updates.
2. Studio + generation + history (incl. recipe reuse).
3. Tagger sidecar + Tagger screen.
4. Library + clusters.
5. Strength grid.
6. Chat co-pilot: JoyCaption hosting spike → TIPO expand → brain chat + patch cards.
7. Ops: PWA, LaunchAgents (app + tagger, + llama-server if the spike needs it), Tailscale serve, login gate.
8. Design pass (mockups → approval → apply).
9. Native iPhone app (optional).

## 8. Out of scope
Multi-user, App Store distribution, Claude API inside the app, Precise Reference/Vibe Transfer
on V5 (until NAI ships them; V4.5 model picker covers the gap), inpainting, Prompt Rail-style macros.
