# ComfyUI Tab (GPU engine + Photo / Video / Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new **ComfyUI** app tab (Photo · Video · Library) driven by one rented Hyperstack GPU VM running unmodified ComfyUI. The app owns the VM's whole life and its spending.

**Architecture:**
- **Server modules:** everything server-side lives in `studio/src/lib/comfy/`. Each piece is pure or injectable (fetch, clock, db), so tests never touch the network or the real `studio.db`:
  - a Hyperstack REST client;
  - a pure spend policy;
  - an engine controller;
  - a ComfyUI HTTP/WS client;
  - workflow templates plus fillers;
  - a job queue.
- **Watchdog:** a 30 s tick started from Next's `src/instrumentation.ts` enforces idle, caps and deadlines, and drains the job queue, even when no tab is open.
- **Pod:** the VM installs pinned ComfyUI via cloud-init. It joins the tailnet with a tagged, reusable, ephemeral key and listens only on its tailnet IP. The app reaches it by MagicDNS name. Models sync over Tailscale SSH from a sha256 manifest in the repo.
- **Stop billing:** the default implementation is hibernate. Task 13 measures hibernate against delete + volume.

**Tech Stack:**
- App: Next.js 16.2.7 (App Router, nodejs runtime), React 19, Tailwind v4, better-sqlite3, sharp, yaml.
- Node 24: global `fetch` and `WebSocket`, so no new deps.
- Tests: node:test via `tsx --test`.
- Pod: ComfyUI (pinned commit) + ComfyUI-VideoHelperSuite, comfyui_controlnet_aux and ComfyUI-Frame-Interpolation (each pinned).

**Spec:** `docs/superpowers/specs/2026-10-17-comfyui-tab-design.md`

## Global Constraints
- **Run commands** from `studio/`:
  - tests: `npm test`;
  - types: `npm run typecheck`;
  - deploy: `npm run deploy` (only when the owner says).
- **Commits:** `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home" commit`, named files only. Never `git add -A`/`.`, never push, never stash. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **New env vars** go in `studio/.env` and are read via `src/lib/env.ts`:
  - `HYPERSTACK_API_KEY`;
  - `HYPERSTACK_KEY_NAME`;
  - `COMFY_TS_AUTHKEY` (reusable + ephemeral + pre-authorized, tag `tag:comfy-pod`);
  - `HF_TOKEN`;
  - `CIVITAI_TOKEN`.
- **Secret handling:**
  - Never log, print, return over HTTP or commit any of these values. `/api/status` may expose booleans only.
  - Rendered cloud-init contains secrets, so never log it or write it to disk.
- **No live Hyperstack call that can bill** (create / restore / start) is made by tests or during development without the owner's go-ahead for that run. All tasks except 13 run fully offline against fakes.
- **Spend defaults** live in settings and are editable in Settings:
  - `comfy.dailyCapUsd` = 10;
  - `comfy.keepWarmMaxH` = 6;
  - `comfy.idleMin` = 50;
  - `comfy.budgetUsd` = 20 (all-time cap; the dev budget).
- **Stop billing** means HIBERNATED or deleted. SHUTOFF still bills, and hibernate-restore only works from HIBERNATED.
- **Pod setup:**
  - ComfyUI runs with `--disable-cuda-malloc` and is never exposed on a public IP.
  - Hyperstack image: `Ubuntu Server 22.04 LTS R570 CUDA 12.8 with Docker`. Every VM needs `key_name`.
- **Licences:** ComfyUI is unmodified, cloned on the pod and never vendored. Record each model's licence in the manifest.
- **Data:**
  - Files go under `data/comfy/` (gitignored).
  - Never write the real `data/` from tests or temp servers. Tests use `new Database(":memory:")` and tmp dirs.
- **UI** uses the Night Studio tokens (`bg-surface`, `text-accent`, …) only, so all 5 themes work.
- **Prompts:** no age wording, and default negatives never mention age.
- **Out of scope:**
  - the Sprites sub-tab (leave a slot), audio, 3D, training, lipsync, inpaint;
  - the NAS link (comes later);
  - any change to the NovelAI Studio tab.

## Review Focus
1. **A stop call fails or the app restarts mid-run.** Expected: the VM is still stopped. The watchdog retries every tick; `reconcile()` on boot finds VMs labelled `nai-comfy` that the DB doesn't know about and hibernates or deletes them; the "GPU still billing" banner shows until it succeeds. *(Tasks 4, 5)*
2. **Pressing Generate while the VM is cold, hibernating or mid-restore.** Expected: the job queues and runs when ready. A restore call made during HIBERNATING waits for HIBERNATED instead of erroring. *(Tasks 2, 5, 7)*
3. **The daily cap is hit mid-job, or keep-warm is set past 6 h.** Expected: the cap stops the VM after the running job finishes (not mid-render), refuses new warms that day with a clear message, and keep-warm clamps to now+6 h. *(Tasks 3, 5)*
4. **The H100 is out of stock, or a picked model or LoRA vanished from the pod.** Expected: boost shows "unavailable" and the main card keeps working; a missing file is rejected before submit with its name, not by a ComfyUI 400 dump. *(Tasks 2, 7)*
5. **A ComfyUI job errors or the WS drops mid-render.** Expected: the job ends `error` with ComfyUI's message, no half item lands in Library, and the queue moves on. Progress falls back to polling `/history`. *(Task 6)*

---

### Task 1: Env, schema and store

**Files:**
- Modify: `studio/src/lib/env.ts`
- Create: `studio/src/lib/comfy/store.ts`
- Create: `studio/src/lib/comfy/store.test.ts`
- Modify: `studio/src/app/api/status/route.ts` (add `comfy: boolean`)
- Modify: `.gitignore` (add `.superpowers/` while you're there; the owner asked to be reminded)

**Interfaces:**
- Produces from `env.ts`: `HYPERSTACK_API_KEY`, `HYPERSTACK_KEY_NAME`, `COMFY_TS_AUTHKEY`, `HF_TOKEN`, `CIVITAI_TOKEN` (strings, default `""`), and `COMFY_DIR = path.join(DATA_DIR, "comfy")`.
- Produces from `store.ts`:
  ```ts
  export type Card = "main" | "boost";
  export type VmRow = { card: Card; vmId: string; env: string; flavor: string; host: string; usdHr: number; status: string };
  export type Run = { id: number; card: Card; vmId: string; usdHr: number; startedAt: number; stoppedAt: number | null; stopReason: string | null };
  export type JobKind = "photo" | "video" | "pose";
  export type Job = { id: number; kind: JobKind; status: "queued" | "running" | "done" | "error"; recipe: unknown; card: Card; progress: number; promptId: string | null; error: string | null; itemId: number | null; createdAt: number };
  export type Item = { id: number; kind: "photo" | "clip"; file: string; poster: string | null; recipe: unknown; seed: number; cost: number; createdAt: number };
  export type ComfySettings = { dailyCapUsd: number; keepWarmMaxH: number; idleMin: number; budgetUsd: number };
  export function migrate(db: Database.Database): void
  export function comfyDb(): Database.Database               // app db, migrated once
  export function getVm(db, card: Card): VmRow | null; export function putVm(db, row: VmRow): void; export function dropVm(db, card: Card): void
  export function openRun(db, card: Card, vmId: string, usdHr: number, now: number): number
  export function closeRun(db, card: Card, now: number, reason: string): void   // closes the open run for that card, no-op if none
  export function runs(db): Run[]
  export function addJob(db, kind: JobKind, recipe: unknown, card: Card, now: number): number
  export function nextQueued(db): Job | null; export function updateJob(db, id: number, patch: Partial<Job>): void; export function readJob(db, id: number): Job | null
  export function addItem(db, it: Omit<Item, "id">): number; export function listItems(db, before?: number, limit?: number): Item[]; export function deleteItem(db, id: number): Item | null
  export function savePose(db, name: string, keypoints: number[]): number; export function listPoses(db): { id: number; name: string; keypoints: number[] }[]
  export function readSettings(db): ComfySettings; export function writeSettings(db, s: Partial<ComfySettings>): ComfySettings  // clamps: cap 1–200, keepWarmMaxH 1–24, idleMin 10–240, budget 1–1000
  export function getState(db): { lastActivity: number; keepWarmUntil: number; boost: boolean; alarm: string | null }
  export function setState(db, patch: Partial<ReturnType<typeof getState>>): void
  ```

**Storage rules:**
- Tables: `comfy_vms`, `comfy_runs`, `comfy_jobs`, `comfy_items`, `comfy_poses`. Use `CREATE TABLE IF NOT EXISTS`, the same idiom as `db.ts`.
- Settings and state go in the existing `settings` table under `comfy.*` keys. Store each key as a string and parse it on read.
- `recipe` and `keypoints` are stored as JSON text.

- [ ] **Step 1: Write the failing test** `store.test.ts`. Each test opens `new Database(":memory:")` and calls `migrate`.
  - `"migrate is idempotent"`: calling `migrate` twice doesn't throw.
  - `"settings default and clamp"`:
    - `readSettings` → `{ dailyCapUsd: 10, keepWarmMaxH: 6, idleMin: 50, budgetUsd: 20 }`;
    - `writeSettings({ dailyCapUsd: 0, keepWarmMaxH: 99 })` → cap 1, keepWarmMaxH 24.
  - `"runs open and close per card"`:
    - `openRun(db,"main","vm1",0.8,1000)`, then `closeRun(db,"main",4600,"idle")`;
    - `runs(db)[0]` has `stoppedAt` 4600 and reason `"idle"`;
    - a second `closeRun` is a no-op.
  - `"jobs queue FIFO"`: two `addJob` calls; `nextQueued` returns the first; after `updateJob(first,{status:"running"})` it returns the second.
  - `"recipe round-trips as JSON"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/store.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `store.ts` and the env additions. `comfyDb()` imports `db` from `@/lib/db` and calls `migrate` once.
- [ ] **Step 4: Run** the test, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the env, store, its test, the status route and `.gitignore`: `feat(comfy): env, schema and store`.

### Task 2: Hyperstack client

**Files:**
- Create: `studio/src/lib/comfy/hyperstack.ts`
- Create: `studio/src/lib/comfy/hyperstack.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. The API key is passed in.
- Produces:
  ```ts
  export type Offer = { env: string; region: string; flavor: string; gpu: string; vramGb: number; usdHr: number };
  export class HyperstackError extends Error { constructor(msg: string, public status: number) }
  export class NoCapacity extends HyperstackError {}
  export type Hyperstack = ReturnType<typeof hyperstack>;
  export function hyperstack(apiKey: string, f?: typeof fetch): {
    offers(minVramGb: number, region?: string): Promise<Offer[]>;           // cheapest first
    create(o: Offer, name: string, userData: string, keyName: string): Promise<string>;  // vm id
    status(id: string): Promise<string | null>;                             // upper-case, null on 404
    hibernate(id: string): Promise<void>;
    restore(id: string): Promise<void>;                                     // waits ≤ 5 min for HIBERNATED if HIBERNATING
    start(id: string): Promise<void>;
    remove(id: string): Promise<void>;                                      // 404 = ok
    listOurs(): Promise<{ id: string; status: string }[]>;                  // label "nai-comfy" only
  }
  ```
- Behaviour copied from Doppelganger's `adapters/hyperstack.py`, which is the reference:
  - headers `api_key: <key>` and `accept: application/json`;
  - offers join `/core/flavors` (and `/core/environments`) to `/pricebook` by exact GPU name. They skip `gpu_count !== 1`, `!stock_available`, `-spot` names and the `no-hibernation` label;
  - `create` body: `{ name, environment_name, flavor_name, image_name, key_name, count: 1, assign_floating_ip: true, user_data, labels: ["nai-comfy"] }`, reading `instances[0].id`. A floating IP is needed only for egress; ComfyUI never binds it (Task 4);
  - hibernate on a SHUTOFF VM calls `start` and then hibernates. Rationale: SHUTOFF bills.
  - `restore` on HIBERNATING polls `status` every 10 s until HIBERNATED, then restores. A 4xx mentioning capacity throws `NoCapacity`.
- The poll interval is injectable for tests: `hyperstack(key, f, { pollMs })`.

- [ ] **Step 1: Write the failing test** with a fake `fetch` that records calls and returns canned JSON.
  - `"offers filter and price"`:
    - Input flavors: an L40 in stock at $1.00 and an RTX-A6000 at $0.50. Also an H100 with `stock_available:false`, an `-spot` flavor and a flavor labelled `no-hibernation`.
    - Call: `offers(48)`.
    - Expected: `[A6000 0.5, L40 1.0]`; the out-of-stock, spot and no-hibernation flavors are dropped.
  - `"create sends key_name, label and user_data and returns id"`.
  - `"hibernate from SHUTOFF starts first"`: call order is GET status → start → hibernate.
  - `"restore while HIBERNATING waits for HIBERNATED"`: status goes HIBERNATING, then HIBERNATED; restore is called once, after.
  - `"status 404 → null; remove 404 → ok"`.
  - `"errors never include the api key"`: on a 401, `err.message` does not contain the key string.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/hyperstack.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `hyperstack.ts`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): hyperstack client`.

### Task 3: Spend policy (pure)

**Files:**
- Create: `studio/src/lib/comfy/spend.ts`
- Create: `studio/src/lib/comfy/spend.test.ts`

**Interfaces:**
- Consumes: `Run` and `ComfySettings` from Task 1.
- Produces:
  ```ts
  export function runCost(r: Run, now: number): number                      // usdHr × hours, open run counted to now
  export function spentSince(runs: Run[], since: number, now: number): number  // only the part of each run after `since`
  export function dayStart(now: number): number                             // local midnight
  export type StopReason = "daily-cap" | "budget" | "idle" | "deadline";
  export function stopReason(a: { runs: Run[]; s: ComfySettings; lastActivity: number; keepWarmUntil: number; busy: boolean; deadline: number | null; now: number }): StopReason | null
  export function canStart(a: { runs: Run[]; s: ComfySettings; now: number }): { ok: true } | { ok: false; why: string }
  export function clampKeepWarm(until: number, s: ComfySettings, now: number): number  // ≤ now + keepWarmMaxH
  ```
- Rules:
  - `daily-cap`: today's spend ≥ `dailyCapUsd`.
  - `budget`: all-time spend ≥ `budgetUsd`.
  - `deadline`: `now ≥ deadline`. This is the dev auto-delete; the engine deletes rather than hibernates.
  - `idle`: `now - lastActivity ≥ idleMin` and `keepWarmUntil ≤ now`.
  - **Busy rule:** when `busy` (a job is running), only `deadline` returns. Caps and idle wait for the job (Review Focus 3).
  - `canStart` refuses with a human sentence naming the cap, e.g. `"Today's GPU cap ($10) is used up — raise it in Settings or wait until tomorrow."`

- [ ] **Step 1: Write the failing test**:
  - `"cost of an open run counts to now"`: 0.9 $/h for 2 h = 1.8.
  - `"daily spend splits a run crossing midnight"`.
  - `"idle fires after idleMin unless keep-warm is in the future"`.
  - `"busy suppresses caps and idle but not deadline"`.
  - `"canStart refuses at the cap and at the budget"`.
  - `"keep-warm clamps to 6 h"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/spend.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `spend.ts`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): spend policy`.

### Task 4: Pod bootstrap and model manifest

**Files:**
- Create: `studio/pod/comfy/cloud-init.yaml` (template with `{{TS_AUTHKEY}}`, `{{HOSTNAME}}`, `{{HF_TOKEN}}`, `{{CIVITAI_TOKEN}}`, `{{MANIFEST_B64}}`)
- Create: `studio/pod/comfy/install.sh` (idempotent, run by cloud-init and on every boot by a systemd unit)
- Create: `studio/pod/comfy/fetch-models.sh` (reads the manifest on stdin or from a file; skips files whose sha256 already matches; downloads into `/opt/comfy/models/<kind>/`)
- Create: `studio/pod/comfy/models.manifest.yaml`
- Create: `studio/src/lib/comfy/pod.ts`
- Create: `studio/src/lib/comfy/pod.test.ts`

**Interfaces:**
- Consumes: env from Task 1.
- Produces:
  ```ts
  export type ManifestEntry = { kind: string; filename: string; sha256: string; size: number; urls: string[]; licence: string; cards: Card[] };
  export function readManifest(file?: string): ManifestEntry[]           // validates: 64-hex sha, kind in an allow-list, https urls
  export function renderCloudInit(card: Card, secrets: { tsAuthKey: string; hfToken: string; civitaiToken: string }): string
  export function podHost(card: Card): string                            // "nai-comfy-main" | "nai-comfy-boost"
  export const COMFY_PORT = 8188;
  export function syncModels(card: Card, run?: (cmd: string, args: string[], stdin: string) => Promise<string>): Promise<string>  // `ssh root@<host> bash /opt/comfy/fetch-models.sh`, manifest on stdin
  ```

**Pod requirements** (`install.sh`):
- Install and update:
  - install Tailscale, then `tailscale up --authkey=… --hostname=<host> --ssh --advertise-tags=tag:comfy-pod`; this runs on every boot because restore doesn't re-run cloud-init;
  - clone ComfyUI at a pinned commit SHA into `/opt/comfy`;
  - clone the 3 custom nodes at pinned SHAs;
  - set up a venv with the CUDA 12.8 torch wheels.
- Run ComfyUI as systemd unit `comfy.service`:
  - command: `python main.py --listen $(tailscale ip -4) --port 8188 --disable-cuda-malloc`;
  - `Restart=always`.
- Each step writes a marker file, so a restored VM skips finished work.

**Manifest:**
- `cards: [main]` entries:
  - one Illustrious-line SDXL checkpoint (WAI-illustrious-SDXL or similar; the owner can swap it);
  - `xinsir/controlnet-union-sdxl-1.0` promax;
  - DWPose models (`yolox_l.onnx`, `dw-ll_ucoco_384.onnx`);
  - Depth-Anything-V2-Small;
  - RIFE `rife47.pth`;
  - Wan 2.2 TI2V 5B (text → video) with its VAE;
  - the Miyabi LoRA, added in Task 13.
- `cards: [main, boost]` entries: Wan 2.2 I2V A14B high-noise + low-noise fp8, the umt5-xxl fp8 text encoder, the Wan 2.1 VAE, and RIFE.
- sha256 values: read each from HF's `x-linked-etag` header via `curl -sI`. Never guess one.

**Tailscale policy** is an owner step. Draft the ACL snippet in the commit message body and ask the owner to apply it:
- `tagOwners` for `tag:comfy-pod`;
- an accept rule from the Mac mini to `tag:comfy-pod:8188`;
- an `ssh` rule from the Mac mini to `tag:comfy-pod` as root.

- [ ] **Step 1: Write the failing test** `pod.test.ts`:
  - `"manifest validates"`: the real manifest parses and every sha256 matches `/^[0-9a-f]{64}$/`.
  - `"cloud-init embeds host, tag and flags"`: the render contains `nai-comfy-main`, `tag:comfy-pod`, `--disable-cuda-malloc`, and `--listen $(tailscale ip -4)`; it does not contain `0.0.0.0`.
  - `"boost cloud-init only carries boost models"`: decode `MANIFEST_B64`; every entry includes `"boost"`.
  - `"syncModels sends the manifest on stdin to the right host"`: uses the fake `run`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/pod.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pod.ts`, the scripts and the manifest. Check the scripts with `bash -n`.
- [ ] **Step 4: Run** the test and `bash -n pod/comfy/*.sh`. Expected: PASS, no syntax errors.
- [ ] **Step 5: Commit** the pod files and `pod.ts`: `feat(comfy): pod bootstrap and model manifest`. Then ask the owner to apply the ACL.

### Task 5: Engine controller, watchdog and engine API

**Files:**
- Create: `studio/src/lib/comfy/engine.ts`
- Create: `studio/src/lib/comfy/engine.test.ts`
- Create: `studio/src/instrumentation.ts`
- Create: `studio/src/app/api/comfy/engine/route.ts`

**Interfaces:**
- Consumes:
  - Task 1 store;
  - Task 2 `Hyperstack`/`Offer`/`NoCapacity`;
  - Task 3 `stopReason`/`canStart`/`clampKeepWarm`/`spentSince`/`dayStart`/`runCost`;
  - Task 4 `renderCloudInit`/`podHost`/`COMFY_PORT`;
  - Task 6 `ping(base)` (for readiness; injected here).
- Produces:
  ```ts
  export type EngineView = { card: Card; phase: "off" | "starting" | "warming" | "ready" | "stopping" | "unavailable"; gpu: string | null; since: number | null;
    usdHr: number; runCost: number; today: number; boost: "off" | "on" | "unavailable"; keepWarmUntil: number; alarm: string | null; deadline: number | null };
  export type Deps = { db: Database.Database; hs: Hyperstack; ping: (base: string) => Promise<boolean>; now: () => number };
  export function engine(d: Deps): {
    warm(card?: Card): Promise<EngineView>;        // touches lastActivity; creates (first time) or restores; refuses via canStart
    keepWarm(until: number): EngineView;           // clamped
    setBoost(on: boolean): Promise<EngineView>;    // on → warm("boost"); off → stop("boost","manual")
    stop(card: Card, reason: string): Promise<void>;   // deadline → remove, else hibernate; closes run; sets alarm on failure
    tick(): Promise<void>;                         // per card: refresh phase, ready check, stopReason → stop, retry alarmed stops
    reconcile(): Promise<void>;                    // listOurs() vs comfy_vms: unknown running VMs → remove; known → adopt status
    view(): { main: EngineView; boost: EngineView };
    base(card: Card): string;                      // `http://${podHost(card)}:${COMFY_PORT}`
  };
  export function getEngine(): ReturnType<typeof engine>   // singleton on globalThis with real deps
  ```

**Phase rules:**
- `starting`: VM create/restore was sent and Hyperstack status is not yet ACTIVE.
- `warming`: ACTIVE, but `ping` is still false.
- `ready`: `ping` is true.
- `unavailable`: `offers()` is empty or `NoCapacity` was raised. For main this shows an error; for boost the switch reads "unavailable".
- A run opens on create/restore, using the offer's `usdHr`, and closes on stop.
- `alarm` is set to `"GPU still billing — retrying stop"` when a stop throws. It clears when a later stop succeeds.
- Dev deadline: when the env var `COMFY_DEV_DEADLINE_MIN` is set, `warm()` sets `deadline = now + min`. Task 13 uses this; it is unset in normal use.

**`instrumentation.ts`:**
- `export async function register()` runs only when `process.env.NEXT_RUNTIME === "nodejs"`.
- It runs `getEngine().reconcile()` once, then a `setInterval(tick, 30_000)` guarded against overlapping ticks.
- The tick also calls `drainQueue()` from Task 7. Import it lazily, so Task 5 ships without it: wire it in at Task 7.

**Engine route:**
- `GET` → `view()`.
- `POST {action: "warm" | "stop" | "boost" | "keepWarm", on?, until?}` → the view, or `{error}` with a 409 for a `canStart` refusal.

- [ ] **Step 1: Write the failing test** `engine.test.ts`, using a fake `Hyperstack` (an in-memory VM map with scripted statuses), a fake clock, a fake `ping` and an in-memory db.
  - `"first warm creates once and opens a run; second warm while starting is a no-op"`.
  - `"warm on a hibernated VM restores instead of creating"`.
  - `"phase goes starting → warming → ready across ticks"`.
  - `"idle tick hibernates and closes the run with reason idle"`.
  - `"deadline deletes instead of hibernating"`.
  - `"failed stop sets alarm and the next tick retries and clears it"` (Review Focus 1).
  - `"reconcile deletes a labelled VM the db doesn't know"` (Review Focus 1).
  - `"warm refused at daily cap with the canStart sentence"`.
  - `"boost with no H100 offer → boost unavailable, main unaffected"` (Review Focus 4).
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `engine.ts`, `instrumentation.ts` and the route.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): engine controller, watchdog and engine API`.

### Task 6: ComfyUI client

**Files:**
- Create: `studio/src/lib/comfy/client.ts`
- Create: `studio/src/lib/comfy/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function ping(base: string, f?: typeof fetch): Promise<boolean>                 // GET /system_stats, 3 s timeout
  export function listModels(base: string, f?): Promise<{ checkpoints: string[]; loras: string[]; samplers: string[]; schedulers: string[] }>  // from /object_info nodes CheckpointLoaderSimple, LoraLoader, KSampler
  export function upload(base: string, name: string, png: Buffer, f?): Promise<string>   // POST /upload/image (multipart, overwrite=true) → stored name
  export function submit(base: string, graph: object, f?): Promise<string>               // POST /prompt → prompt_id; 400 → throws with node_errors joined into one sentence
  export function watch(base: string, promptId: string, onProgress: (p: number) => void, opts?: { ws?: typeof WebSocket; f?: typeof fetch; pollMs?: number }): Promise<{ files: { filename: string; subfolder: string; type: string }[] }>
  export function fetchOutput(base: string, file: { filename: string; subfolder: string; type: string }, f?): Promise<Buffer>   // GET /view
  ```
- `watch` details:
  - It opens `ws://…/ws?clientId=<uuid>`; `submit` uses the same `client_id`.
  - Progress is `value/max` from `progress` messages.
  - It resolves on `executing` with `node: null` for this prompt, then reads `/history/<id>` for the outputs (images, gifs and videos).
  - It rejects with the message from an `execution_error`.
  - On a WS close or error before completion, it falls back to polling `/history/<id>` every `pollMs` (2 s) (Review Focus 5).

- [ ] **Step 1: Write the failing test**, using a fake fetch and a fake WebSocket class that emits scripted messages.
  - `"listModels reads object_info"`.
  - `"submit surfaces node_errors as one sentence"`.
  - `"watch reports progress and resolves with history outputs"`.
  - `"watch rejects on execution_error with its message"`.
  - `"watch falls back to /history when the socket drops"` (Review Focus 5).
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `client.ts`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): ComfyUI HTTP/WS client`.

### Task 7: Workflows, recipes, job queue and Library API

**Files:**
- Create: `studio/src/lib/comfy/workflows/photo.json`
- Create: `studio/src/lib/comfy/workflows/pose-extract.json`
- Create: `studio/src/lib/comfy/workflows/video-i2v.json`
- Create: `studio/src/lib/comfy/workflows/video-t2v.json`
  - All four are exported from ComfyUI in API format. Node ids are stable strings that the filler targets by id. Keep the ids documented in a top-level `"_ids"` key that the filler strips.
- Create: `studio/src/lib/comfy/recipe.ts` (types, validation, graph fillers)
- Create: `studio/src/lib/comfy/recipe.test.ts`
- Create: `studio/src/lib/comfy/jobs.ts` (`drainQueue`)
- Create: `studio/src/lib/comfy/jobs.test.ts`
- Create: `studio/src/lib/comfy/estimate.ts` (+ the estimate test in `recipe.test.ts`)
- Create: `studio/src/app/api/comfy/jobs/route.ts`, `studio/src/app/api/comfy/jobs/[id]/route.ts`
- Create: `studio/src/app/api/comfy/items/route.ts`, `studio/src/app/api/comfy/file/[name]/route.ts`
- Create: `studio/src/app/api/comfy/models/route.ts`, `studio/src/app/api/comfy/poses/route.ts`
- Modify: `studio/src/instrumentation.ts` (call `drainQueue` in the tick)

**Interfaces:**
- Consumes: Tasks 1, 5 (`getEngine().base`, `view`, `warm`) and 6.
- Produces (`recipe.ts`):
  ```ts
  export type Lora = { name: string; strength: number };              // strength −2…2
  export type PoseRef = { kind: "pose" | "depth" | "lineart"; image: string; strength: number };  // image = uploaded name on the pod
  export type PhotoRecipe = { mode: "photo"; model: string; prompt: string; negative: string; loras: Lora[]; pose: PoseRef | null;
    seed: number; steps: number; cfg: number; sampler: string; scheduler: string; width: number; height: number; hires: { scale: number; denoise: number } | null };
  export type VideoRecipe = { mode: "animate" | "t2v" | "extend" | "loop"; prompt: string; negative: string; loras: Lora[]; start: number | null /* item id */;
    end: number | null; seconds: number; motion: "low" | "medium" | "high"; fps: 16 | 30 | 60; size: "480p" | "720p"; seed: number; steps: number; cfg: number };
  export function validatePhoto(r: unknown, models: { checkpoints: string[]; loras: string[] }): PhotoRecipe   // throws Error("LoRA “x” isn't on the GPU any more")
  export function validateVideo(r: unknown, models: { loras: string[] }): VideoRecipe
  export function photoGraph(r: PhotoRecipe): object
  export function poseGraph(image: string, kind: PoseRef["kind"]): object
  export function videoGraph(r: VideoRecipe, frames: { start?: string; end?: string }): object
  export function wanFrames(seconds: number): number                 // 16·s+1 rounded to 4k+1, s clamped 1–10
  ```
- `estimate.ts`:
  ```ts
  export function estimate(r: PhotoRecipe | VideoRecipe, gpu: string, usdHr: number): { seconds: number; usd: number }
  ```
  It is a lookup table keyed by recipe kind × card class (`48gb` | `h100`) × size, scaled by steps and frames. The starting numbers are placeholders; Task 13 replaces them with measured ones. Mark the table with a `// ponytail:` comment saying so.

**Validation and limits:**
- Width and height: multiples of 64, 512–2048. Steps 1–150. CFG 0–30. These are not NovelAI caps (spec: "no free-tier caps").
- A seed of −1 is replaced with a random 32-bit value before storing.

**Graph fillers:**
- `photoGraph` chains `LoraLoader` nodes off the checkpoint, one per LoRA.
- With a pose, it inserts `ControlNetLoader` (union) → `SetUnionControlNetType` (openpose/depth/canny-lineart) → `ControlNetApplyAdvanced` with strength.
- With hires, it adds a latent upscale and a second KSampler at the set denoise.
- The default negative is the checkpoint's usual quality negative. It contains no age words.

**Video graphs:**
- `video-i2v.json`: Wan 2.2 I2V A14B with a high-noise pass then a low-noise pass (2 KSamplerAdvanced steps split).
- It uses `WanFirstLastFrameToVideo` when there is an end frame.
- Mode mapping:
  - `loop`: end = start.
  - `extend`: start = the clip's stored last frame.
- Then `RIFE VFI` with multiplier `{16: 1 (node bypassed), 30: 2, 60: 4}[fps]`, and `VHS_VideoCombine` at `frame_rate = fps`. 30 fps plays about 6% slow (32 → 30); that is acceptable.
- `VHS_VideoCombine` writes an h264 mp4.
- A `SaveImage` of `ImageFromBatch(last)` gives the poster/last frame.
- Motion maps to an appended phrase: low = "subtle gentle movement", medium = nothing, high = "dynamic energetic movement". Mark it `// ponytail:`, to retune after the live run.
- `t2v` uses `video-t2v.json` (Wan 2.2 TI2V 5B).

**Jobs (`jobs.ts`):**
```ts
export async function drainQueue(d?: { db; eng; client }): Promise<void>
```
- If no job is `running` and the next queued job's card is `ready`:
  - upload any start/end/pose images (read from `COMFY_DIR`);
  - `submit`, then `watch`, with progress written to the db;
  - on done: `fetchOutput` → write `COMFY_DIR/<ts>-<seed>.<png|mp4>` (+ the `-last.png` poster), `addItem` with the run cost share, and mark the job done;
  - on error: mark the job `error` with the message and add no item.
- If the card is `off`, call `warm(card)` (Review Focus 2).
- Every submit touches `lastActivity`.
- Pose jobs return the extracted keypoints JSON and the preprocessed image in `job.recipe.result` rather than a Library item.

**Routes:**
- `POST /api/comfy/jobs {kind, recipe}` → `{id}`. It validates against `listModels` (cached 60 s) when the card is ready, otherwise at drain time. It starts a warm.
- `GET /api/comfy/jobs/:id` → `{status, progress, error, itemId, result?}`.
- `GET /api/comfy/items?before=` → items; `DELETE /api/comfy/items?id=` → removes the row and its files.
- `GET /api/comfy/file/:name` streams from `COMFY_DIR`, with the name checked by the same rule as `safeGalleryName`. Reuse it if it's exported; otherwise apply `/^[\w.-]+$/`.
- `GET /api/comfy/models` → `listModels`, or `{pending:true}` when not ready.
- `GET/POST /api/comfy/poses` → `listPoses` / `savePose`.

- [ ] **Step 1: Write the failing tests**:
  - `recipe.test.ts`:
    - `"photoGraph chains two LoRAs in order with their strengths"`;
    - `"photoGraph with a pose inserts union ControlNet with the right type and strength"`;
    - `"hires adds a second sampler at the set denoise"`;
    - `"validatePhoto rejects a LoRA not on the GPU, naming it"` (Review Focus 4);
    - `"loop sets end = start; 60 fps sets RIFE ×4"`;
    - `"wanFrames(5) = 81"`;
    - `"estimate scales with frames and card price"`.
  - `jobs.test.ts`, using a fake engine/client and a tmp `COMFY_DIR`:
    - `"queued job waits while warming and runs when ready"` (Review Focus 2);
    - `"error leaves no item and the next job runs"` (Review Focus 5);
    - `"done writes file + poster and adds an item with recipe and seed"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/recipe.test.ts src/lib/comfy/jobs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the workflows (hand-written API-format JSON is fine; Task 13 re-exports them if the real pod disagrees), `recipe.ts`, `estimate.ts`, `jobs.ts`, the routes, and the instrumentation wiring.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): workflows, recipes, job queue and Library API`.

### Task 8: Pose model (pure)

**Files:**
- Create: `studio/src/lib/comfy/pose.ts`
- Create: `studio/src/lib/comfy/pose.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Kp = [x: number, y: number, c: number];                       // 18 OpenPose body points, normalised 0–1
  export function fromOpenPose(json: unknown): Kp[] | null                  // first person's pose_keypoints_2d, normalised by canvas_width/height
  export const LIMBS: [number, number, string][]                           // the 17 OpenPose limb pairs with their standard colours
  export function mirror(k: Kp[]): Kp[]                                    // x → 1−x and swap L/R indices (2↔5, 3↔6, 4↔7, 8↔11, 9↔12, 10↔13, 14↔15, 16↔17)
  export function moveJoint(k: Kp[], i: number, x: number, y: number): Kp[] // clamps 0–1, sets c = 1
  ```
- Hands and face are not editable; only the 18 body points are. That is enough for "drag the dots" and keeps the editor usable on a phone.

- [ ] **Step 1: Write the failing test**:
  - `"fromOpenPose normalises and keeps 18 points"`;
  - `"mirror swaps sides and flips x"`;
  - `"mirror twice is identity"`;
  - `"moveJoint clamps"`;
  - `"fromOpenPose returns null for no people"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/pose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pose.ts`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(comfy): pose keypoint model`.

### Task 9: Tab shell, GPU status line and Settings

**Files:**
- Modify: `studio/src/lib/tabs.ts`: add `"comfy"` to `Tab` and to `TABS` after `studio`, with label "ComfyUI", short "Comfy" and a line icon (a node/graph glyph).
- Modify: `studio/src/app/page.tsx`: mount `<ComfyScreen active={tab === "comfy"} />` in a `div` hidden when inactive (same pattern as `roll`), and give it the `pb-0` padding like chat/rp.
- Create: `studio/src/components/comfy/ComfyScreen.tsx` (sub-tab pills Photo · Video · Library, plus a disabled "Sprites — soon" slot)
- Create: `studio/src/components/comfy/GpuLine.tsx`
- Create: `studio/src/components/comfy/Drawer.tsx` (drag-up sheet: grab handle, prompt textarea, tool slot, primary button, progress bar)
- Create: `studio/src/lib/comfy/view.ts` (pure label helpers) + `view.test.ts`
- Modify: `studio/src/components/SettingsSheet.tsx`: add a "GPU" group with daily cap ($), keep-warm max (h) and idle stop (min). Its `GET/POST` goes to a new `studio/src/app/api/comfy/settings/route.ts` that calls `readSettings` / `writeSettings`.
- Check: `LiquidIsland.tsx` and `Mascot.tsx` read `TABS`/`TAB_IDS`. Confirm a 6th tab fits the island at 390 px width; if it doesn't, shrink the gap and don't drop labels.

**Interfaces:**
- Consumes: the Task 5 engine route and the Task 1 settings.
- Produces from `view.ts`:
  ```ts
  export function gpuLabel(v: EngineView, now: number): string   // "● L40 warming… 40s" | "● L40 ready · $0.42" | "○ GPU off" | "● GPU unavailable"
  export function alarmText(v: EngineView): string | null
  ```
- `ComfyScreen` behaviour:
  - It POSTs `warm` once when it first becomes active; that is the pre-warm (spec).
  - It polls `GET /api/comfy/engine` every 5 s while active, and stops polling when inactive.
  - The prompt and drawer stay usable whatever the GPU phase (anti-goal: slow first use).
- `GpuLine` contents:
  - the label;
  - a boost toggle showing "H100" / "unavailable";
  - a "keep warm until…" control: a `<input type="time">` posted as epoch, with the clamp happening server-side;
  - a "Stop now" button;
  - a full-width danger banner when `alarm` is set.

- [ ] **Step 1: Write the failing test** `view.test.ts`:
  - `"warming shows seconds since start"`;
  - `"ready shows run cost to the cent"`;
  - `"alarm text present only when alarm set"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `view.ts`, then the components, the tabs and page wiring, and the Settings group.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then check the UI on a temp dev server with a scratch DB copy. The engine phase is `off`, because no API key is set in the temp env.
  - Start the server: `cp ../data/studio.db $SCRATCH/studio.db` then run `next dev` on another port, pointing at it the way previous plans did.
  - Check that the tab appears in the island, the sub-tabs switch, "○ GPU off" shows, and the drawer opens.
  - Expected: no console errors.
- [ ] **Step 5: Commit**: `feat(comfy): tab shell, GPU status line, GPU settings`.

### Task 10: Photo sub-tab (Model · LoRA · Pose · Tune)

**Files:**
- Create: `studio/src/components/comfy/PhotoPane.tsx`
- Create: `studio/src/components/comfy/LoraStack.tsx`
- Create: `studio/src/components/comfy/PoseEditor.tsx`
- Create: `studio/src/components/comfy/TuneSheet.tsx`
- Create: `studio/src/lib/comfy/photo-draft.ts` + `photo-draft.test.ts` (the default recipe; localStorage draft with try/catch, same idea as `lib/draft.ts`)

**Interfaces:**
- Consumes:
  - Task 7: `PhotoRecipe`, `estimate`, and the jobs/models/poses routes;
  - Task 8: `Kp`, `LIMBS`, `mirror`, `moveJoint`, `fromOpenPose`;
  - Task 9: `Drawer`.
- Produces from `photo-draft.ts`:
  ```ts
  export function defaultPhoto(models: string[]): PhotoRecipe   // first checkpoint, 832×1216, 28 steps, cfg 5.5, euler_ancestral/normal, seed −1
  export function loadPhoto(): PhotoRecipe | null
  export function savePhoto(r: PhotoRecipe): void
  ```

**Chips** (each opens the drawer with its tool):
- **Model:** a list from `/api/comfy/models`. Shows "Waiting for GPU…" while pending.
- **LoRA:** add from the list; one slider per LoRA (−2…2, step 0.05); remove.
- **Pose:**
  1. Pick a reference (`<input type="file" accept="image/*">` or a Library item).
  2. Choose Copy pose / depth / outline.
  3. A `pose` job runs.
  4. For `pose`, the keypoints are drawn over the canvas as SVG; joints are 44 px touch targets (dragging works with pointer events and `touch-action: none`).
  5. Controls: strength slider, Mirror, Reset (back to the extracted keypoints), Save pose (name prompt via an inline input, not `window.prompt`), and a saved-poses row.
  6. On Generate, the edited skeleton is rendered client-side to a PNG on a black canvas at the recipe size, using `LIMBS` colours. It is uploaded with the job; the server stores it in `COMFY_DIR/pose-<ts>.png` and passes its name as `PoseRef.image`.
  7. Depth and outline refs are used as extracted and can't be edited.
- **Tune:** seed (with dice), steps, CFG, sampler and scheduler (from models), width/height presets plus custom fields, negative prompt, and a hi-res toggle (scale 1.5, denoise 0.4 defaults).

**Generate:**
- POST the job, then poll `/api/comfy/jobs/:id` every 1 s while it's queued or running, showing "Queued — GPU warming" or the percent.
- When done, show the item on the canvas.
- An estimate line sits above the button.

- [ ] **Step 1: Write the failing test** `photo-draft.test.ts`:
  - `"default recipe uses first checkpoint and spec sizes"`;
  - `"loadPhoto survives storage throwing"` (stub a throwing `localStorage` on `globalThis`).
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/photo-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `photo-draft.ts` and the components.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then check on the temp dev server: the chips open their tools, pose dragging works with touch emulation at 390 px, and Generate shows "Queued — GPU warming". The job stays queued because the GPU is offline in temp env; delete the scratch DB afterwards.
- [ ] **Step 5: Commit**: `feat(comfy): Photo sub-tab with LoRA stack, pose editor and tune`.

### Task 11: Video sub-tab (modes · Motion · estimate)

**Files:**
- Create: `studio/src/components/comfy/VideoPane.tsx`
- Create: `studio/src/components/comfy/MotionSheet.tsx`
- Modify: `studio/src/lib/comfy/photo-draft.ts`: add `defaultVideo(): VideoRecipe` (animate, 5 s, medium, 60 fps, loop off, 480p, 20 steps, cfg 3.5) and `loadVideo` / `saveVideo`. Test it in `photo-draft.test.ts`.

**Interfaces:**
- Consumes: Task 7 `VideoRecipe`, `estimate`, `wanFrames`; Task 9 `Drawer`, `GpuLine`; Task 10's polling helper. If it's needed twice, extract it into `Drawer.tsx` as `useJob(id)`.

**Behaviour:**
- The mode chips row is Animate image (default), Text → video, Extend clip and Loop. Leave room for future modes, without placeholders.
- **Start frame:** the last Photo result ("Last Photo ✓") or Pick… from Library photos. For Extend, the pick is from Library clips; the server uses that clip's poster/last frame.
- **Motion drawer:**
  - length 1–10 s;
  - motion low/medium/high;
  - smooth to 16 / 30 / 60;
  - seamless loop toggle (on = Loop mode);
  - end frame: same as start, or Pick…;
  - size 480p / 720p.
- The estimate line reads `~4 min on L40 ≈ $0.06`. It uses the current card; when boost is on, it uses H100.
- The result plays in a `<video playsinline loop muted autoplay controls>` on the canvas.

- [ ] **Step 1: Write the failing test** in `photo-draft.test.ts`: `"default video recipe matches the spec defaults"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/photo-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the video defaults and the components.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then do a temp-dev-server check like Task 10's.
- [ ] **Step 5: Commit**: `feat(comfy): Video sub-tab with modes, motion and estimate`.

### Task 12: Library sub-tab

**Files:**
- Create: `studio/src/components/comfy/LibraryPane.tsx`
- Create: `studio/src/lib/comfy/reuse.ts` + `reuse.test.ts`

**Interfaces:**
- Consumes: the Task 7 items routes, plus the draft savers from Tasks 10–11.
- Produces from `reuse.ts`:
  ```ts
  export function reuseTarget(it: Item): { pane: "photo"; recipe: PhotoRecipe } | { pane: "video"; recipe: VideoRecipe }
  export function asStartFrame(it: Item, v: VideoRecipe): VideoRecipe   // photo → start = it.id, mode animate
  ```

**Behaviour:**
- A newest-first grid that pages with `before`. Clips show their poster with a ▶ badge.
- Tapping an item opens a viewer with:
  - the full recipe (model, LoRAs, pose thumbnail, settings, seed, start frame);
  - **Reuse** (loads into Photo or Video and switches the sub-tab);
  - **Animate this** (photos only);
  - **Delete**. Delete is an inline two-tap confirm, not `window.confirm`.

- [ ] **Step 1: Write the failing test** `reuse.test.ts`:
  - `"photo item reuses into photo pane with its seed"`;
  - `"clip item reuses into video pane"`;
  - `"asStartFrame sets start and animate mode"`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/comfy/reuse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `reuse.ts` and `LibraryPane.tsx`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then check on the temp dev server, using rows seeded into the **scratch** DB copy only.
- [ ] **Step 5: Commit**: `feat(comfy): Library sub-tab with recipe, reuse and send-to-video`.

### Task 13: Supervised live run (owner present, inside the $20 budget)

No new feature code. Fixes found here get their own commits. **Stop and get the owner's explicit go-ahead before Step 2, and again before any step that starts a VM.** Report each run's minutes and dollars from `runs()`.

**Files:**
- Modify (data only, as measured):
  - `studio/pod/comfy/models.manifest.yaml` (add the Miyabi LoRA with its sha256);
  - `studio/src/lib/comfy/estimate.ts` (replace the placeholder numbers);
  - `studio/src/lib/comfy/workflows/*.json` (if the real pod's node inputs differ).

- [ ] **Step 1: Pre-flight (offline).**
  - The owner has put the 5 env vars in `studio/.env`. Verify by checking that `/api/status` returns `comfy: true`, never by printing values.
  - The owner has applied the tailnet ACL.
  - Set `COMFY_DEV_DEADLINE_MIN=45` in `studio/.env` for this session.
  - Deploy with `npm run deploy`, once the owner agrees.
- [ ] **Step 2: First warm (supervised).**
  - Open the tab on the phone and watch the phase move off → starting → warming → ready.
  - Record the first-boot time (install plus model download).
  - Expected: ready, with the running cost shown in the GPU line.
- [ ] **Step 3: Miyabi Photo test.**
  - The owner picks a Miyabi LoRA on Civitai. Add it to the manifest and run `syncModels("main")`.
  - Generate a posed Miyabi-like image: LoRA plus the pose from a reference, with one joint dragged.
  - Expected: the image is in Library with its recipe.
- [ ] **Step 4: Video test.**
  - Animate that image as a 5 s seamless loop at 60 fps, 480p.
  - Expected: an mp4 in Library that loops cleanly. Record the render time.
- [ ] **Step 5: Stop-billing measurement.**
  - Press Stop now. Time how long hibernate takes, then how long a restore takes to reach ready.
  - With the owner's go-ahead, time the delete + persistent-volume alternative once using a throwaway script in the scratchpad (not shipped).
  - Report both. If the volume path is clearly faster, write a short follow-up plan and keep hibernate shipped for now.
- [ ] **Step 6: Safety checks (live).**
  - Kill the app process while the VM runs, restart it, and confirm that `reconcile` adopts the VM.
  - Let idle trigger by temporarily setting `comfy.idleMin` to 10 on the real settings, **with the owner's OK**, then restore it.
  - Confirm the VM ends HIBERNATED and the run is closed.
- [ ] **Step 7: Wrap-up.**
  - Fill `estimate.ts` with the measured numbers and run `npm test`.
  - Remove `COMFY_DEV_DEADLINE_MIN` from `.env` once the owner has seen the costs.
  - Confirm with `listOurs()` that no VM is left running.
- [ ] **Step 8: Commit** the manifest, estimate and any workflow fixes: `chore(comfy): live-run measurements and Miyabi LoRA`. Then give the owner a total-spend report.
