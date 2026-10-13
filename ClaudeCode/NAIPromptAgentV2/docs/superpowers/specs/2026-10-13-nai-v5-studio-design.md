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
   ├─ /api/tag       → tagger sidecar :8190 (FastAPI: PixAI Tagger v1.0)
   ├─ /api/caption   → ToriiGate-0.5 (tag-grounded caption) | JoyCaption Beta One (2nd opinion)
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
  - **Artists come from PixAI's `style` category** (4,917 artists, style micro-F1 0.81), emitted as
    `artist:name`. Camie v2 was dropped (user-approved 2026-10-13): PixAI beats it on artists, so a second
    model and its GPL license bought only `year` guesses.
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
Each job goes to the model that is best at it, all local, all NSFW-capable, all resident together
(~19 GB of 24 GB):

| Role | Model | Size | Why | Runs via |
|---|---|---|---|---|
| Tagging | PixAI v1.0 (§4.4) | ~2 GB | Purpose-built taggers beat any LLM at booru tags | tagger sidecar |
| Captioning (default) | **Minthy/ToriiGate-0.5** (Qwen3.5-4B base, MIT; GGUF `DraconicDragon/ToriiGate-0.5-GGUF` Q4_K_M + Q8_0 mmproj) | ~3.4 GB | Anime captioner with no censorship; takes booru tags + character names as grounding → character-aware NL caption / ready prompt. Uses the prompts from its `scripts/prompts.py`; ~1 Mpx input; single image, single turn | `llama-server` :8191 (brew llama.cpp) |
| Captioning (second opinion, toggle) | fancyfeast **JoyCaption Beta One** (GGUF `mradermacher/llama-joycaption-beta-one-hf-llava-GGUF` Q4 + mmproj) | ~5.5 GB | Equal SFW/NSFW training; independent read for hard images; Booru-tags mode | `llama-server` :8192 |
| Syntax / prompt expansion | **KBlueLeaf TIPO-v2.1-1B-A200M** (GGUF Q8, Kohaku License) | ~1 GB | Danbooru-trained: expands prompts, converts tags ↔ natural language, rating-conditioned up to `explicit`, emits real tags | Ollama, `raw: true` completion |
| Brain: scenes, themes, arcs, clusters, conversation (default) | **HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced** Q4_K_M (+ BF16 mmproj) | ~7.4 GB | Reasons before answering; tuned for creative writing/RP; 0/465 refusals claimed; can also see images in chat. Card samplers: temp 0.6, top_k 64, top_p 0.9, min_p 0.05, repeat 1.1 | Ollama `hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M` |
| Brain alternative (picker) | **Qwen3.8-9B-heretic-uncensored** Q4_K_M (Apache-2.0) | ~5.7 GB | Stronger structured JSON + Japanese; switch to it if patch cards come out malformed | Ollama |

The 24B models (`dolphin-mistral-24b`, `cydonia-24b`) are no longer used by this app (Delfino keeps
them).

- Drawer, off by default. On → loads the brain with keep-alive; off → `keep_alive: 0`.
- **Pipeline:** "Read this image" = taggers → ToriiGate grounded on those tags (+ JoyCaption if
  toggled) → brain merges into a scene with patch cards. "Expand" = TIPO on the current lines →
  brain only rewrites when asked. All emitted tags go through the CSV/YAML check.
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

**Design challenge 1 (2026-10-13) — chosen: A · Night Studio.** Mockups: https://claude.ai/artifact/6grZ7dujXbPAcYSLkSNbjx.
Brief: deep navy ground (#0d1020), raised navy surfaces, lilac accent (#b7a4ff, tweakable), IBM Plex Sans + IBM Plex
Mono for labels/numbers; header with model pill + SAFE/NSFW/OFF segmented control; latest image beside a compact
AI/Custom position canvas with numbered colored dots; numbered base-prompt rail with weight badges and a token
counter (x / 1471); characters as rows keyed by their dot color; sticky Generate bar showing size/steps/"free";
bottom tab bar Studio / Tagger / Library / Grid / Chat. Rejected: B Darkroom (dots-on-image idea kept as a possible
later option), C Console.

### 4.8 Native iPhone app (optional, last phase, "if polish allows")
SwiftUI app built in Xcode 26 and installed directly to Ruruphone (team 9TL96DXFPC), talking to the
same `/api/*` over Tailscale. Starts as a native shell (tab bar, share-sheet "Tag this image",
photo-library save, haptics) hosting the web Studio in WKWebView; screens go fully native only where
the web version measurably falls short. No App Store submission.

## 5. Error handling
- NAI: 401 → "token invalid/expired"; 429 → "rate limited, wait"; 500 → "request rejected
  (often missing v4 prompt fields)"; network → retry button. No silent retries that spend Anlas.
- Tagger/Ollama/captioner (llama-server) offline → banner, rest of app keeps working.
- Grid: abort on first error, keep finished cells.
- Saves are atomic (write temp + rename) so YAML is never left half-written.

## 6. Testing
One runnable check per non-trivial unit: prompt serialization → V5 body; patch-op applier; NAI PNG
metadata parser (fixture PNG); tagger threshold/sort filter; tagger sidecar smoke test (`/tag` on a
fixture image); one smoke call each to TIPO, ToriiGate and JoyCaption. Plus one real end-to-end V5 generation and a phone run-through over Tailscale per
phase.

## 7. Phases (each usable on its own)
1. V5 rules doc + skill updates.
2. Studio + generation + history (incl. recipe reuse).
3. Tagger sidecar + Tagger screen.
4. Library + clusters.
5. Strength grid.
6. Chat co-pilot: llama-server captioners (ToriiGate, JoyCaption) → TIPO expand → Gemma4 brain chat + patch cards.
7. Ops: PWA, LaunchAgents (app, tagger, llama-server captioners), Tailscale serve, login gate.
8. Design pass (mockups → approval → apply).
9. Native iPhone app (optional).

## 8. Out of scope
Multi-user, App Store distribution, Claude API inside the app, Precise Reference/Vibe Transfer
on V5 (until NAI ships them; V4.5 model picker covers the gap), inpainting, Prompt Rail-style macros.
