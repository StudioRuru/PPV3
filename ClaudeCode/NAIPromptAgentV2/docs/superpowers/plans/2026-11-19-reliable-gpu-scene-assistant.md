# Reliable GPU + Scene Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing Start on the Comfy GPU reliably reaches a ready ComfyUI and shows a per-step checklist with a Retry button. A new Scene chat turns plain text into model-ready Anime, Photo or Video prompts that one tap sends into Photo or Video.

**Architecture:**
- **Track 1** hardens the existing pieces where they fail:
  - `hyperstack.ts`: state rules for volume operations.
  - `pod.ts` / `loras.ts` / `train.ts`: SSH by tailnet IP with a wait and retry.
  - New `preflight.ts`: a link check against the saved volume file list.
  - `engine.ts`: launch steps on `EngineView`, rendered by `GpuLine.tsx`.
- **Track 2** adds:
  - A pure `scene.ts` library: targets, prompt builder, JSON parser, emphasis/tag/LoRA/beat cleaning.
  - A streaming `/api/comfy/scene` route.
  - A `ScenePane` sub-tab that reuses ComfyScreen's existing load-into-Photo/Video plumbing.

**Tech Stack:** Next.js (App Router) + TypeScript, better-sqlite3, `node:test` via `tsx --test`, Hyperstack REST, Tailscale, ComfyUI, Ollama / KoboldCpp / Chub via `llm.ts`.

**Spec:** `docs/superpowers/specs/2026-11-19-reliable-gpu-scene-assistant-design.md`

## Global Constraints

- All commands run from `studio/`.
  - Tests: `npm test`. Single file: `npx tsx --test src/lib/comfy/<file>.test.ts`.
  - Typecheck: `npm run typecheck`.
- **Live server:**
  - Don't build in the live directory: no `next build` under the running :3100 server. Build only during deploy + kickstart (Task 9).
  - Temp/scratch dev servers get a blank `HYPERSTACK_API_KEY`, or they hit real pods.
- **Secrets:** the Hyperstack key, HF/Civitai tokens and the Chub key are never logged and never sent to the client.
- **Billing safety beats every other rule:** an unreachable pod still hibernates, and nothing may leave a VM billing while the UI says off.
- **API calls:** no retry loop may call Hyperstack every tick for the same failure. Log one line per VM per operation.
- **UI:** phone-first. The wide Mac layout must not break. Match the existing GpuLine style and liquid-glass nav.
- **Scene assistant content:**
  - It reuses the `/prompt` skill's references (`REPO_DIR/.claude/skills/prompt/references/*.md`) and `data/themes/`. No second tag vocabulary.
  - It only suggests installed LoRAs with their real triggers.
  - It does not soften or refuse the owner's scenes.
- **Emphasis budget:**
  - Anime: `{{}}` on 1–2 tags, `{}` on 3–6, the rest unweighted.
  - **Builder call:** ComfyUI SDXL uses `(tag:w)` weights, not NAI braces. `scene.ts` converts `{{x}}` → `(x:1.2)` and `{x}` → `(x:1.1)` after enforcing the budget.
- **Code style:** follow the ponytail rules already in the codebase. Shortest working diff, reuse existing helpers, and a `ponytail:` comment on any deliberate ceiling.

## Review Focus

1. **Server restart in the middle of a start.**
   - Expected: the checklist shows the step the reconcile tick lands on, not a blank list or a crash. Pinned by an engine test in Task 4.
2. **Hibernate requested while the VM is RESTORING.**
   - Expected: no detach call, no 426, and the stop completes once the VM settles (or, if stuck, hibernates without detaching and raises the alarm). Pinned by a test in Task 4.
3. **The model's reply has no JSON block, a broken one, or two blocks.**
   - Expected: text-only reply, no crash, no Send button. If there are two blocks, the last one wins. Pinned by a parser test in Task 6.
4. **The model invents a LoRA or uses one from the wrong family.**
   - Expected: it's dropped silently and the reply notes "dropped: X". Pinned by a LoRA filter test in Task 6.
5. **Send to Video with one beat, or with more than two beats.**
   - Expected: seconds = clamp(beats × 5, 1, 10), and `beats(prompt, segments)` returns the shown beats in order. Pinned by a beat test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/comfy/hyperstack.ts` (modify) | State-aware `attachWhenActive`, `restore`, `hibernate` |
| `src/lib/comfy/pod.ts` (modify) | `syncModels`/`releaseModels` take a host. New: `waitSsh`, `withRetry`, `listVolume`, `fetchedCount` |
| `src/lib/comfy/loras.ts`, `train.ts` (modify) | Callers take the resolved host |
| `src/lib/comfy/preflight.ts` (create) | HEAD check of manifest URLs for files missing from the saved volume list, with a 24 h cache |
| `src/lib/comfy/store.ts` (modify) | Export `getJson`/`putJson` (settings table, `comfy.*` keys) |
| `src/lib/comfy/engine.ts` (modify) | Launch steps, retry, preflight gate, host wiring |
| `src/lib/comfy/view.ts` (modify) | `stepError()` plain-words map |
| `src/components/comfy/GpuLine.tsx` (modify) | Checklist UI + `retry` action |
| `src/app/api/comfy/engine/route.ts` (modify) | `retry` case |
| `pod/comfy/models.manifest.yaml` (modify) | Krea2 URL fix |
| `src/lib/comfy/scene.ts` (create) | Targets, system prompt, parser, cleaning (pure + one fs read) |
| `src/app/api/comfy/scene/route.ts` (create) | Streaming chat, clean patch, chat persistence |
| `src/components/comfy/ScenePane.tsx` (create) | Scene chat UI |
| `src/components/comfy/ComfyScreen.tsx`, `VideoPane.tsx` (modify) | Scene sub-tab, Send wiring, open start picker |

---

## Track 1 — Reliable GPU launch

### Task 1: State-aware volume ops

**Files:**
- Modify: `src/lib/comfy/hyperstack.ts` (`attachWhenActive`, `restore`, `hibernate`)
- Test: `src/lib/comfy/hyperstack.test.ts` (use the existing `fake()` helper with `pollMs: 1`)

**Interfaces:**
- Produces:
  - `attachWhenActive(vmId: string, volumeName: string): Promise<void>`. The signature is unchanged; only the behaviour changes.
  - `restore(id: string): Promise<void>`
  - `hibernate(id: string, volumeName?: string): Promise<{ detached: boolean }>`
  - `export const TRANSITIONAL: ReadonlySet<string>` with `RESTORING, HIBERNATING, BUILD, STARTING, REBOOT, RESIZING, SHUTTING_DOWN`
  - `export function canDetach(status: string | null): boolean`, which is true only for `ACTIVE` and `SHUTOFF`

- [ ] **Step 1: Write the failing tests**

```ts
test("attach waits through RESTORING then attaches", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": [{ body: { instance: { status: "RESTORING" } } }, { body: { instance: { status: "ACTIVE" } } }],
    "GET /core/volumes": { body: { volumes: [{ id: 5, name: "vol", status: "available", environment: { name: "e" } }] } },
    "POST /core/virtual-machines/7/attach-volumes": { status: 200 },
  });
  await hyperstack("K", f, { pollMs: 1 }).attachWhenActive("7", "vol");
  assert.ok(calls.some((c) => c.method === "POST" && c.path.endsWith("/attach-volumes")));
});
test("attach 400 'already attached' is success", async () => { /* attach-volumes → {status:400, body:{message:"There are already attached Volumes"}}; resolves */ });
test("attach throws on ERROR", async () => { /* status ERROR → rejects with /ERROR/ */ });
test("restore waits out a transitional state before calling", async () => { /* HIBERNATING, HIBERNATING, HIBERNATED → exactly one GET /hibernate-restore, issued after HIBERNATED */ });
test("hibernate skips detach when not ACTIVE/SHUTOFF", async () => { /* status RESTORING → no POST detach-volumes; GET /hibernate still called; returns {detached:false} */ });
test("hibernate detaches when ACTIVE", async () => { /* status ACTIVE → POST detach-volumes then GET /hibernate; {detached:true} */ });
```

Match the route keys to the paths `hyperstack.ts` already calls. Read them from the file; don't guess.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx tsx --test src/lib/comfy/hyperstack.test.ts`
Expected: the new tests FAIL. The existing tests still pass.

- [ ] **Step 3: Implement**

- `attachWhenActive`: poll `status` until it is ACTIVE.
  - Keep waiting on `TRANSITIONAL` or null-but-recent states.
  - Throw on `ERROR`, on gone (null after it was seen), or on the existing timeout.
  - A 400 whose body text matches `/already attached/i` resolves.
- `restore`: wait while the status is in `TRANSITIONAL` (bounded by `RESTORE_WAIT_MS`), then call once.
- `hibernate`:
  - Detach only if `canDetach(status)` after the existing SHUTOFF handling.
  - Treat a detach 4xx as a warning, not a failure.
  - Return `{ detached }`.
- Logging: add a module-level `warnOnce(key: string, msg: string)` (a `Set` of seen keys, `${vmId}:${op}`) and use it in place of the bare `console.warn` calls.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test src/lib/comfy/hyperstack.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comfy/hyperstack.ts src/lib/comfy/hyperstack.test.ts
git commit -m "fix(comfy): state-aware volume attach/detach/restore"
```

### Task 2: SSH by tailnet IP, after SSH is up

**Files:**
- Modify: `src/lib/comfy/pod.ts`, `src/lib/comfy/loras.ts`, `src/lib/comfy/train.ts`, `src/app/api/comfy/loras/route.ts:32`, `src/app/api/comfy/models/route.ts:14`, `src/lib/comfy/engine.ts` (`getEngine` wiring only)
- Test: `src/lib/comfy/pod.test.ts` (create if absent; fake `Run`)

**Interfaces:**
- Produces:
  - `syncModels(card: Card, host: string, run?: Run): Promise<string>`. Returns the script's stdout.
  - `releaseModels(card: Card, host: string, run?: Run): Promise<void>`
  - `waitSsh(host: string, run?: Run, sleep?: (ms: number) => Promise<void>): Promise<void>`
    - Backoff: probes `ssh ${SSH_OPTS} -o ConnectTimeout=10 root@host true` with delays `[5_000, 10_000, 20_000, 40_000, 40_000, 40_000]` ms, about 2.6 min.
    - Throws `Error("SSH never answered on <host>")` after the last attempt.
  - `withRetry<T>(fn: () => Promise<T>, isNet: (e: unknown) => boolean, sleep?, delays = [10_000, 30_000]): Promise<T>`. Retries only when `isNet(e)`.
  - `isNetError(e: unknown): boolean`. Matches `/Could not resolve hostname|Connection (timed out|refused|reset)|port 22|kex_exchange|Broken pipe/i`. A `FAILED kind/name` from `fetch-models.sh` is **not** a network error.
  - `fetchedCount(stdout: string): number`, the number of lines starting with `get `.
  - `listVolume(host: string, run?: Run): Promise<{ name: string; size: number }[]>`. Runs `find /opt/comfy/models -type f -printf '%P %s\n'` over SSH.
    - **Builder call:** listing over SSH, not a new script.
    - `name` is `kind/filename`, matching how `fetch-models.sh` prints entries.
  - `export const hostFor = (card: Card, ip?: string | null) => ip || podHost(card)`
  - `loras.ts`: `pushLoras(host: string, dir?)`, `videoLoras(names, host: string)`
  - `train.ts`: `startTrain(..., host: string)`, `trainStatus(host: string)`. The single flight is keyed per host.
  - The engine exposes `host(card: Card): string` on its return object, as `hostFor(card, addr.get(card))`.
- Consumes: `podHost`, `SSH_OPTS`, `Run` from `pod.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
test("waitSsh retries until ssh answers", async () => {
  let n = 0; const run: Run = async () => { if (++n < 3) throw new Error("ssh: connect to host 100.1.2.3 port 22: Connection timed out"); return ""; };
  await waitSsh("100.1.2.3", run, async () => {});
  assert.equal(n, 3);
});
test("waitSsh gives up after the schedule", async () => { /* always throws → rejects /SSH never answered/, run called 7 times */ });
test("withRetry does not retry a download failure", async () => { /* fn throws Error("FAILED diffusion_models/x") → called once */ });
test("withRetry retries a resolve failure twice", async () => { /* throws "Could not resolve hostname" thrice → called 3 times, rejects */ });
test("fetchedCount counts get lines", () => assert.equal(fetchedCount("skip a/b\nget c/d\nget e/f\nmodels ok\n"), 2));
test("syncModels sshes the given host", async () => { /* fake run records args; args include "root@100.1.2.3" */ });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx tsx --test src/lib/comfy/pod.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement the `pod.ts` exports above, then update every caller**

- Update every `podHost("main")` default caller to pass a host.
- The routes and `engine.ts` call `getEngine().host("main")`.
- Check nothing was missed with `grep -rn 'podHost(' src | grep -v test`. The only hits left should be `hostFor`, cloud-init and the `resolve` call.
- In `getEngine()`:
  - `sync: async (c) => { const h = e.host(c); await waitSsh(h); const out = await withRetry(() => syncModels(c, h), isNetError); ...pushLoras(h) for main...; await dropModels(); return out; }`
  - `release: (c) => releaseModels(c, e.host(c))`
  - `Deps.sync`'s type becomes `(card) => Promise<string>`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comfy src/app/api/comfy
git commit -m "fix(comfy): ssh by tailnet IP with ssh wait + network retry"
```

### Task 3: Model link preflight + Krea2 URL

**Files:**
- Create: `src/lib/comfy/preflight.ts`
- Modify: `src/lib/comfy/store.ts` (export `getJson`, `putJson`), `pod/comfy/models.manifest.yaml`
- Test: `src/lib/comfy/preflight.test.ts`

**Interfaces:**
- Produces:
  - `store.ts`:
    - `getJson<T>(db: Db, k: string): T | null`
    - `putJson(db: Db, k: string, v: unknown): void`
    - Both use the existing `comfy.` prefix.
  - `preflight.ts`:
    - `type Dead = { label: string; filename: string; url: string; status: number }`
    - `preflight(card: Card, deps: { db: Db; manifest: ManifestEntry[]; head: (url: string) => Promise<number>; now: number }): Promise<Dead[]>`
      - Entries: `manifest.filter(e => e.cards.includes(card))` minus those whose `kind/filename` and `size` match `getJson(db, "volume." + card)`.
      - Only the main card ever has a saved list.
      - An entry is dead only when **all** of its `urls` return ≥ 400.
      - Cache: on zero dead, `putJson(db, "preflight." + card, now)`. Skip all HEADs if that is < 24 h old.
    - `headUrl(url: string): Promise<number>`
      - `fetch(url, { method: "HEAD", redirect: "follow", headers })`.
      - Adds `Authorization: Bearer HF_TOKEN` for `huggingface.co` and `Authorization: Bearer CIVITAI_TOKEN` for `civitai.*` hosts.
      - On network error, returns 599 (counted as dead).
      - Uses a 15 s timeout.
    - `saveVolumeList(db: Db, card: Card, files: { name: string; size: number }[]): void`. Writes `volume.<card>` and clears `preflight.<card>`.
    - `deadMessage(d: Dead[]): string`, e.g. `"Krea2 checkpoint link is dead — fix the manifest (krea2Softrealism_v10.safetensors, 404)"`. The label is `${family-ish name from filename} ${kind}`. **Builder call:** a short table `{ diffusion_models: "checkpoint", loras: "LoRA", text_encoders: "text encoder", vae: "VAE" }`, with the filename stem for the rest.
- Consumes: `readManifest()` and `ManifestEntry` from `pod.ts`; `listVolume` from Task 2.

- [ ] **Step 1: Write the failing tests**

```ts
const e = (filename: string, size: number, urls = ["https://a/x"]) => ({ kind: "diffusion_models", filename, sha256: "", size, urls, licence: "", cards: ["main"] });
test("only entries missing from the saved volume list are checked", async () => {
  const db = memDb(); saveVolumeList(db, "main", [{ name: "diffusion_models/a.safetensors", size: 10 }]);
  const seen: string[] = [];
  const dead = await preflight("main", { db, manifest: [e("a.safetensors", 10, ["https://a"]), e("b.safetensors", 5, ["https://b"])], head: async (u) => (seen.push(u), 200), now: 1 });
  assert.deepEqual([dead, seen], [[], ["https://b"]]);
});
test("dead only when every mirror fails", async () => { /* urls [404, 200] → []; urls [404, 500] → one Dead with status 404 */ });
test("good result cached 24 h", async () => { /* second call at now+1h → head not called; at now+25h → called */ });
test("size mismatch counts as missing", async () => { /* saved size 9, manifest 10 → checked */ });
test("no saved list checks every entry", async () => { /* boost card → all HEADed */ });
```

`memDb()`: open `new Database(":memory:")` and run `migrate()`, the same pattern other comfy tests use (copy it from an existing `*.test.ts` that does this).

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx tsx --test src/lib/comfy/preflight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `preflight.ts` + the store helpers**

- [ ] **Step 4: Fix the Krea2 URL**

- Run `curl -sIL -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CIVITAI_TOKEN" '<each krea2Softrealism url>'`, with the token taken from `studio/.env` and never echoed.
- If it is dead, find the current version/file id on the Krea2 SoftRealism Civitai model page and replace both mirror URLs. Update `size`/`sha256` only if the file changed.
- If the owner has a fresher source, note it in the commit.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx tsx --test src/lib/comfy/preflight.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/comfy/preflight.ts src/lib/comfy/preflight.test.ts src/lib/comfy/store.ts pod/comfy/models.manifest.yaml
git commit -m "feat(comfy): preflight model links against the saved volume list; fix Krea2 URL"
```

### Task 4: Engine launch steps, retry, preflight gate

**Files:**
- Modify: `src/lib/comfy/engine.ts`, `src/lib/comfy/view.ts`, `src/app/api/comfy/engine/route.ts`
- Test: `src/lib/comfy/engine.test.ts` (existing fakes), `src/lib/comfy/view.test.ts`

**Interfaces:**
- Produces:
  - `type StepId = "links" | "gpu" | "disk" | "network" | "comfy" | "ready" | "models"`
  - `type Step = { id: StepId; state: "wait" | "run" | "ok" | "fail"; startedAt: number | null; endedAt: number | null; error: string | null; note?: string }`. `note` carries e.g. `"fetched 3 files"`.
  - `EngineView` gains `steps: Step[] | null`.
    - It is null while the phase is `off`, or once `ready` **and** models is ok.
    - Main uses all seven steps. Boost skips `disk`.
  - `engine(...)` returns `retry(card: Card, step: StepId): Promise<EngineView>`.
  - `Deps` gains `preflight?(card: Card): Promise<string | null>`, which returns a dead message or null. It also gains `listVolume?(card: Card): Promise<{ name: string; size: number }[]>`.
  - `view.ts`: `stepError(step: StepId, raw: string): string`. Plain words, no secrets, at most 120 characters.
  - `EngineAction` (`GpuLine.tsx`) gains `| { action: "retry"; card: Card; step: StepId }`. The route calls `getEngine().retry(b.card, b.step)` and validates `step` against the `StepId` list (400 otherwise).
- Consumes: Tasks 1–3 (`hibernate` returns `{detached}`, `waitSsh`, `fetchedCount`, `preflight`, `saveVolumeList`).

**Step rules (in-memory `steps` Map per card, reset on each `warm`):**
- **links:**
  - runs first in `warmInner`, before `canStart`/billing.
  - On a dead link: fail the step, throw `Refused(msg)`, and create no VM.
- **gpu:** ok when the tick sees `ACTIVE`.
- **disk:** this step tracks the background `attachWhenActive` promise. Its rejection fails the step with `stepError("disk", e.message)`.
- **network:**
  - ok when `resolve` returns an IP and a `waitSsh(host)` probe (in the sync chain) passes.
  - The tick marks `run` once the VM is ACTIVE.
- **comfy:** ok on the first successful `ping`.
- **ready:** ok when the phase becomes ready.
- **models:**
  - Starts after ready and runs `d.sync`.
  - On success: `note = "fetched N files"` via `fetchedCount`, then `listVolume` → `saveVolumeList`.
  - On failure: fail with the error. The card stays ready.
- **Restart / reconcile:** if `steps` has no entry for a card that isn't off, synthesize from the current phase, marking every earlier step ok.
- **`retry(card, step)`** re-runs only that step's action and never recreates the VM:
  - links → re-run preflight (and warm if it passes).
  - disk → `attachWhenActive` again.
  - network / comfy → clear and let the tick re-evaluate.
  - models → `synced.delete(card)`.
  - gpu → `restore` if hibernated, else no-op.
- **Stop path (anti-426):**
  - In `stopNow`, if `hs.status` is in `TRANSITIONAL` and the card isn't stuck (`hibSince` < 10 min), set the status `stopping:<reason>` and return without calling Hyperstack. The tick re-enters `stop` once the status is ACTIVE/SHUTOFF/ERROR or the card is stuck. That waiting is the "outside the lock" wait.
  - If `hibernate` returns `{detached:false}` for a card with a models volume, set the alarm `"Stopped without detaching the models volume — it may show RESERVED; contact Hyperstack if the next start fails"`. Add this alarm via `setState`, as a separate string beside `ALARM`.

- [ ] **Step 1: Write the failing tests**

```ts
test("dead link blocks warm before any VM is created", async () => { /* deps.preflight → "Krea2 checkpoint link is dead"; warm rejects Refused; hs.create never called; view.steps[0] = {id:"links", state:"fail"} */ });
test("steps advance gpu→comfy→ready, models trails", async () => { /* fake status ACTIVE, resolve ip, ping true, sync resolves "get a/b\nmodels ok" → after ticks: ready ok, models ok note "fetched 1 files"; listVolume called; steps null once all ok */ });
test("failed sync keeps card ready and shows models fail", async () => { /* sync rejects → phase "ready", models.state "fail" */ });
test("retry models re-runs sync without recreating", async () => { /* after fail, retry("main","models") + tick → sync called twice, create once */ });
test("stop during RESTORING does not call hibernate", async () => { /* status RESTORING → no hibernate call; status stopping:manual; next tick status ACTIVE → hibernate called once */ });
test("restart mid-start synthesizes steps from phase", async () => { /* new engine over db with vm status "warming" → steps gpu ok, network run */ });
// view.test.ts
test("stepError maps known failures", () => {
  assert.match(stepError("network", "ssh: Could not resolve hostname nai-comfy-main"), /network|tailnet/i);
  assert.match(stepError("disk", "RESERVED"), /RESERVED/);
  assert.ok(!stepError("links", "Bearer abc123").includes("abc123"));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx tsx --test src/lib/comfy/engine.test.ts src/lib/comfy/view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the step rules above in `engine.ts`, `stepError` in `view.ts`, and the route `retry` case**

Wire `getEngine()`:
- `preflight: (c) => preflight(c, { db, manifest: readManifest(), head: headUrl, now: Date.now() }).then((d) => d.length ? deadMessage(d) : null)`
- `listVolume: (c) => listVolume(e.host(c))`

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comfy src/app/api/comfy/engine/route.ts src/components/comfy/GpuLine.tsx
git commit -m "feat(comfy): launch checklist steps, per-step retry, preflight gate, no detach on transitional VMs"
```

### Task 5: GpuLine checklist UI

**Files:**
- Modify: `src/components/comfy/GpuLine.tsx` (+ its CSS module or the existing styles it uses)

**Interfaces:**
- Consumes: `EngineView.steps`, `Step`, `StepId` (import the types only; the component is client-side), and the `retry` `EngineAction` from Task 4.

- [ ] **Step 1: Render the checklist**

- When `view.steps` is non-null, the line expands into one row per step:
  - The icon is ✓ / spinner / ✕ / dot.
  - Labels: `Links, GPU, Disk, Network, ComfyUI, Ready, Models`.
  - Elapsed seconds: `(endedAt ?? now) - startedAt`.
  - `note` shows when present.
- A failed row shows `error` and a **Retry this step** button, which calls `onAction({ action: "retry", card: view.card, step })`.
- When `steps` becomes null, it collapses back to today's line.
- Reuse the existing spinner/colour tokens. Don't add new design tokens.

- [ ] **Step 2: Verify in a scratch dev server**

- Run `HYPERSTACK_API_KEY= PORT=3200 npx next dev` from a scratch copy, or as an isolated dev server. **Never** use the :3100 dir's `.next`.
- Then load the Comfy tab at a phone viewport (390×844) and at a wide viewport.
- Force a view with a failed step by temporarily stubbing `/api/comfy/engine`, or with a dead preflight (a bad URL in a scratch manifest copy).
- Expected: the checklist renders, Retry posts `{action:"retry"}`, nothing overflows at 390 px, and the wide layout is unchanged.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/components/comfy
git commit -m "feat(comfy): GPU launch checklist with retry this step"
```

---

## Track 2 — Scene Assistant

### Task 6: Scene core library

**Files:**
- Create: `src/lib/comfy/scene.ts`
- Test: `src/lib/comfy/scene.test.ts`

**Interfaces:**
- Produces:
  - `type Target = "anime" | "photo" | "video"`
  - `const TARGETS: Record<Target, { label: string; family: Family; model: string; refs: string[] }>`. One entry each, with these model defaults:
    - anime → WAI (`family "sdxl"`; model = the installed WAI checkpoint name from `defaultPhoto`'s list, matched by `/wai/i`).
    - photo → Krea 2 (`"krea2"`).
    - video → Wan (`refs` = `natural-language-hybrid.md` + the video rules written inline).
    - `refs` lists the prompt-skill reference files to inline. Anime gets `tag-guide.md, auto-weighting.md, negative-prompts.md, scene-themes.md`. Photo gets `natural-language-hybrid.md`.
  - `type SceneOut = { target: Target; prompt: string; negative?: string; beats?: { from: number; to: number; text: string }[]; loras: { name: string; strength: number }[] }`
  - `scenePrompt(target: Target, loras: { name: string; family: Family; words: string[] }[], readRef: (file: string) => string): string`
    - The system prompt holds the inlined refs, the target dialect rules from the spec, the installed fitting LoRAs with their triggers, and the required trailing fenced `json` block shape.
    - It always ends with: revise the previous prompt when the owner asks for a change.
  - `parseScene(text: string): { prose: string; out: unknown | null }`
    - Takes the **last** ```json fenced block. Malformed JSON gives `out: null`.
    - `prose` is the text with that block removed.
  - `cleanScene(raw: unknown, ctx: { target: Target; known: Set<string>; loras: { name: string; family: Family; words: string[] }[] }): { out: SceneOut; dropped: string[] } | null`
    - Returns null when the input isn't an object or the prompt is empty.
    - Anime:
      - Split tags on commas. Drop unknown tags (after stripping braces/weights, lowercasing, and replacing spaces with `_` for the lookup).
      - Run `budget()`, then `naiToComfy()`.
    - LoRAs:
      - Keep only names in `ctx.loras` whose `family` fits the target (`fits()`), clamping strength to 0–1.5.
      - Insert triggers with `addTriggers(prompt, words)`.
    - Video:
      - Build `beats` from `raw.beats` texts, each 5 s (`from = 5k`, `to = 5k + 5`).
      - Set the prompt to the beats joined as one sentence each (append "." if the beat doesn't end in `.!?`).
      - Drop beats beyond 2 (10 s max), adding `"beat 3+"` to `dropped`.
    - `dropped` lists removed tag and LoRA names.
  - `budget(tags: string[]): string[]`
    - Keeps the first 2 `{{x}}` and the first 6 `{x}`.
    - Demotes the extras: a `{{x}}` past the cap becomes `{x}` while `{}` slots remain, otherwise plain. A `{x}` past the cap becomes plain.
  - `naiToComfy(tags: string[]): string`. `{{x}}` → `(x:1.2)`, `{x}` → `(x:1.1)`, joined with `", "`. Underscores become spaces, except in tags that already contain `(`.
  - `videoSeconds(n: number): number`, which is `Math.min(10, Math.max(1, n * 5))`.
- Consumes:
  - `beats`, `family`, `fits` from `recipe.ts` / `lora-info.ts`. Check which file exports `fits` and its exact signature before use.
  - `addTriggers` from `triggers.ts`; `knownTags()` from `tag-index.ts`, used by the route, not here.

- [ ] **Step 1: Write the failing tests**

```ts
test("budget keeps 2 double and 6 single", () => {
  const t = ["{{a}}", "{{b}}", "{{c}}", "{d}", "{e}", "{f}", "{g}", "{h}", "{i}", "{j}", "k"];
  const out = budget(t);
  assert.equal(out.filter((x) => x.startsWith("{{")).length, 2);
  assert.equal(out.filter((x) => /^\{[^{]/.test(x)).length, 6);
  assert.equal(out.length, t.length);
});
test("naiToComfy converts weights", () => assert.equal(naiToComfy(["{{long_hair}}", "{smile}", "1girl"]), "(long hair:1.2), (smile:1.1), 1girl"));
test("parseScene takes last json block; malformed → null", () => {
  assert.deepEqual(parseScene("hi\n```json\n{\"a\":1}\n```\nmore\n```json\n{\"b\":2}\n```").out, { b: 2 });
  assert.equal(parseScene("x ```json\n{bad\n```").out, null);
  assert.equal(parseScene("no block").out, null);
});
test("cleanScene drops unknown tags and wrong-family LoRAs", () => {
  const r = cleanScene({ prompt: "1girl, {smile}, notatag", loras: [{ name: "sdxlA", strength: 2 }, { name: "wanB", strength: 1 }, { name: "ghost", strength: 1 }] },
    { target: "anime", known: new Set(["1girl", "smile"]), loras: [{ name: "sdxlA", family: "sdxl", words: ["trig"] }, { name: "wanB", family: "wan", words: [] }] })!;
  assert.deepEqual(r.out.loras, [{ name: "sdxlA", strength: 1.5 }]);
  assert.ok(r.out.prompt.includes("trig") && r.out.prompt.includes("(smile:1.1)") && !r.out.prompt.includes("notatag"));
  assert.deepEqual(r.dropped.sort(), ["ghost", "notatag", "wanB"]);
});
test("video beats align with beats() and seconds", () => {
  const r = cleanScene({ prompt: "", beats: [{ text: "She sits on the rooftop" }, { text: "She stands and her hair blows." }], loras: [] }, { target: "video", known: new Set(), loras: [] })!;
  assert.deepEqual(r.out.beats!.map((b) => [b.from, b.to]), [[0, 5], [5, 10]]);
  assert.deepEqual(beats(r.out.prompt, 2), ["She sits on the rooftop.", "She stands and her hair blows."]);
  assert.equal(videoSeconds(1), 5); assert.equal(videoSeconds(3), 10);
});
test("cleanScene returns null for non-object or empty prompt", () => { assert.equal(cleanScene("x", ctx), null); assert.equal(cleanScene({ prompt: " " , loras: [] }, { ...ctx, target: "photo" }), null); });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx tsx --test src/lib/comfy/scene.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `scene.ts`**

- No IO except through the injected `readRef`.
- The video dialect rules live inline in `scenePrompt`: subject → setting → camera → one action per beat, at most 2 beats, each one sentence.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test src/lib/comfy/scene.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comfy/scene.ts src/lib/comfy/scene.test.ts
git commit -m "feat(comfy): scene assistant core — targets, parser, emphasis budget, tag/LoRA/beat cleaning"
```

### Task 7: Scene route + persistence

**Files:**
- Create: `src/app/api/comfy/scene/route.ts`
- Test: covered by Task 6 (pure logic) + the Step 3 curl check

**Interfaces:**
- Produces:
  - `GET /api/comfy/scene` → `{ chat: SceneChat, models: string[] }`
    - `SceneChat = { target: Target; model: string; turns: { role: "user" | "assistant"; content: string; out?: SceneOut; dropped?: string[] }[] }`
    - `models` = `BRAIN_MODEL` plus the `kobold:`/`chub:` entries from `installedModels()`.
  - `POST /api/comfy/scene` with body `{ text: string; target: Target; model?: string }`
    - Streams `text/plain` tokens. The final chunk is a line `\n\u0000` followed by the JSON `{ out: SceneOut | null; dropped: string[] }`.
    - **Builder call:** a NUL sentinel, so the client splits prose from result without a second request.
    - On error, streams `\n\n⚠️ msg` (the same pattern as `api/chat/route.ts`).
  - `DELETE /api/comfy/scene` clears the chat ("New scene").
  - Storage: `putJson(comfyDb(), "scene.chat", chat)`, keeping the last 30 turns. **Builder call:** a settings key, not ThreadStore, so it never appears in the Chat list.
- Consumes:
  - `scenePrompt`, `parseScene`, `cleanScene`, `TARGETS` (Task 6).
  - `chatStream`, `heavyGate` (`llm.ts`).
  - `installedModels` (`rp/server.ts`).
  - `knownTags` (`tag-index.ts`).
  - The installed LoRA list with families and words: the same source `/api/comfy/loras` + `resolveInfo` use. Read that route and call the same functions.
  - `getJson`/`putJson` (Task 3).
  - `REPO_DIR` for refs.

- [ ] **Step 1: Implement the route**

- Follow `api/chat/route.ts`'s `ReadableStream` pattern.
- For a `kobold:`/`chub:` model, wrap the stream in `heavyGate.run`; the brain runs directly.
- History: the last 12 turns, sending the assistant turns' prose plus their cleaned JSON so revisions build on the last prompt.
- Reject a `model` not in `models` and a `text` longer than 4,000 characters with 400.
- Set `export const dynamic = "force-dynamic"`, as the sibling routes do.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke-check on a scratch dev server** (blank `HYPERSTACK_API_KEY`, port 3200)

Run: `curl -sN -X POST localhost:3200/api/comfy/scene -H 'content-type: application/json' -d '{"text":"she sits on a rooftop at night, then stands and the wind catches her hair","target":"video"}' | tail -c 600` (add the auth cookie if `APP_PASSWORD` is set).
Expected: prose, then the NUL line with `out.beats` of length 2 and `out.prompt` made of two sentences. A second POST, `"make it raining"`, returns a revised prompt that still has both beats.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/comfy/scene
git commit -m "feat(comfy): /api/comfy/scene streaming route with persisted scene chat"
```

### Task 8: Scene sub-tab + Send to Photo/Video

**Files:**
- Create: `src/components/comfy/ScenePane.tsx`
- Modify: `src/components/comfy/ComfyScreen.tsx` (`Sub`, `SUBS`, send handlers), `src/components/comfy/VideoPane.tsx` (accept an `openTool?: Tool` with the nonce)

**Interfaces:**
- Produces:
  - `ScenePane({ onSendPhoto, onSendVideo }: { onSendPhoto(out: SceneOut): void; onSendVideo(out: SceneOut): void })`
  - `Sub` gains `"scene"`. `SUBS` order: `Scene · Photo · Video · Sprites · Library`. The default sub stays whatever it is today.
  - `loadVideo` gains `tool?: "start"`. When it's set, `VideoPane` opens its existing start-frame drawer (Library picker + upload) once per nonce.
- Consumes: the `/api/comfy/scene` contract (Task 7); `SceneOut`, `TARGETS`, `videoSeconds` (Task 6); `validatePhoto`, `validateVideo`, `defaultPhoto`, `defaultVideo`, `loadVideoDraft`, plus ComfyScreen's existing `setLoadPhoto`/`setLoadVideo` nonce pattern.

- [ ] **Step 1: Build `ScenePane`**

- Top row: the target segmented control (Anime / Photo / Video) and the model select (from `GET`).
- Chat list:
  - Streamed assistant text.
  - Under each assistant turn that has `out`: the prompt in a code-style block, beats as a `0–5 s · …` list for video, LoRA chips (name × strength), a muted "dropped: …" line, and **Send to Photo** / **Send to Video** (only the one matching the target; anime and photo both send to Photo).
- Input bar with a **New scene** button (DELETE).
- Mirror the RP chat composer styles, and keep it usable at 390 px.

- [ ] **Step 2: Wire Send in `ComfyScreen`**

- **Photo:**
  - `const r = { ...defaultPhoto(models), model: TARGETS[out.target].model resolved against installed models, prompt: out.prompt, negative: out.negative ?? DEFAULT_PHOTO_NEGATIVE, loras: out.loras }`.
  - Pass it through `validatePhoto(r, models)`. On success, `setLoadPhoto({recipe, nonce})` and switch to the Photo sub. On a thrown error, show its message as the existing toast.
- **Video:**
  - `{ ...(loadVideoDraft() ?? defaultVideo()), mode: "animate", prompt: out.prompt, negative: out.negative ?? DEFAULT_VIDEO_NEGATIVE, loras: out.loras, seconds: videoSeconds(out.beats?.length ?? 1), start: null }`.
  - Skip `validateVideo` here, because it rejects `start: null`. Validation runs at Generate, as it does today.
  - `setLoadVideo({ recipe, nonce, tool: "start" })`, then switch to Video.

- [ ] **Step 3: Verify on a scratch dev server at 390×844 and wide**

Expected:
- Three scenes, one per target, each produce a reply with a Send button.
- Photo Send lands in Photo with the prompt and LoRAs filled.
- Video Send lands in Video with the start-frame drawer open.
- After picking a Library frame, Generate is enabled and the motion field shows the two sentences.
- Reloading the page keeps the chat.

- [ ] **Step 4: Typecheck, full tests, commit**

```bash
npm run typecheck && npm test
git add src/components/comfy
git commit -m "feat(comfy): Scene sub-tab with Send to Photo/Video"
```

### Task 9: Deploy + live acceptance

- [ ] **Step 1: Deploy :3100**

Use the existing deploy + kickstart flow: the studio's deploy script/launchd, the same one used for 0d7784f. Read `package.json` scripts / the deploy notes before running anything. Don't run `next build` in the live dir outside that flow.

- [ ] **Step 2: Check the spec's "Done when" items on the phone**

- One real start from hibernated main shows the checklist end-to-end, with Models trailing after Ready.
- A forced dead-link start (a scratch manifest copy pointed at by a temp env var, or a scratch server with a blank Hyperstack key) shows the plain message and creates no VM.
- Three plain scenes are sent into Photo/Video.
- A two-beat video generates as two chained segments that match the beats.

- [ ] **Step 3: Update memory**

Update `project_nai_v5_studio.md` and the MEMORY.md line with the deploy commit and what's still pending.
