import type Database from "better-sqlite3";
import { type Card, type VmRow, comfyDb, getJson, getVm, putVm, dropVm, openRun, closeRun, runs, readSettings, getState, setState } from "./store";
import { type Hyperstack, type Offer, NoCapacity, TRANSITIONAL, hyperstack } from "./hyperstack";
import { canStart, clampKeepWarm, dayStart, runCost, spentSince, stopReason } from "./spend";
import { pushLoras } from "./loras";
import { COMFY_PORT, fetchedCount, hostFor, isNetError, listVolume, modelsVolume, podHost, readManifest, releaseModels, renderCloudInit, syncModels, tailnetIp, waitSsh, withRetry } from "./pod";
import { dropModels, ping } from "./client";
import { COMFY_TS_AUTHKEY, CIVITAI_TOKEN, HF_TOKEN, HYPERSTACK_API_KEY, HYPERSTACK_KEY_NAME } from "@/lib/env";
import { trainStatus, training } from "./train";
import { deadMessage, headUrl, preflight, saveVolumeList } from "./preflight";
import { stepError } from "./view";

export type StepId = "links" | "gpu" | "disk" | "network" | "comfy" | "ready" | "models";
export type Step = { id: StepId; state: "wait" | "run" | "ok" | "fail"; startedAt: number | null; endedAt: number | null; error: string | null; note?: string };
export const STEP_IDS: StepId[] = ["links", "gpu", "disk", "network", "comfy", "ready", "models"];

export type EngineView = {
  card: Card; phase: "off" | "starting" | "warming" | "ready" | "stopping" | "unavailable"; gpu: string | null; since: number | null;
  usdHr: number; runCost: number; today: number; boost: "off" | "on" | "unavailable"; keepWarmUntil: number; alarm: string | null; deadline: number | null;
  /** A hibernated VM holds the downloaded models (storage-only cost) until flushed. */
  kept: boolean;
  /** Launch checklist; null while off, and once ready with the models synced. */
  steps: Step[] | null;
};
export type Deps = { db: Database.Database; hs: Hyperstack; ping: (base: string) => Promise<boolean>; now: () => number; resolve?: (host: string) => Promise<string | null>; sync?: (card: Card) => Promise<string>; release?: (card: Card) => Promise<unknown>;
  /** A dead-link message; `block` fails the warm before any VM exists, otherwise it is only a warning on the links step. */
  preflight?: (card: Card) => Promise<{ msg: string; block: boolean } | null>;
  listVolume?: (card: Card) => Promise<{ name: string; size: number }[]> };
/** warm() refused by the spend policy; `message` is the user-facing sentence. */
export class Refused extends Error {}

const ALARM = "GPU still billing — retrying stop";
const DETACH_ALARM = "Stopped without detaching the models volume — it may show RESERVED; contact Hyperstack if the next start fails";
const CARDS: Card[] = ["main", "boost"];
const WARM_MAX_MS = 90 * 60_000;
const PHASE = { starting: "starting", warming: "warming", ready: "ready" } as const;

export function engine(d: Deps) {
  const { db, hs } = d;
  const unavailable = new Set<Card>();
  const busy = new Set<Card>(); // a warm call is mid-flight for this card
  const pendingStop = new Map<Card, string>(); // stop requested while warm() was in flight
  const locks = new Map<Card, Promise<void>>(); // stops are serialized per card
  const orphans = new Set<string>(); // labelled VMs the db doesn't know whose remove failed
  const hibSince = new Map<Card, number>(); // when a hibernate was accepted but not yet confirmed
  const synced = new Set<Card>(); // manifest pushed to this card's live pod since it came up (restore never re-runs cloud-init)
  const detachWarn = new Set<Card>(); // hibernated without detaching the models volume
  const steps = new Map<Card, Step[]>(); // launch checklist, reset on each warm
  let reconciled = false;
  let tickN = 0;
  const addr = new Map<Card, string>(); // the live pod's tailnet IP, refreshed each tick while ACTIVE
  const host = (card: Card) => hostFor(card, addr.get(card));
  const base = (card: Card) => `http://${host(card)}:${COMFY_PORT}`;
  const dlKey = (c: Card) => `comfy.deadline.${c}`;
  const readDeadline = (c: Card): number | null => {
    const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(dlKey(c)) as { value: string } | undefined;
    return r && Number(r.value) > 0 ? Number(r.value) : null;
  };
  const writeDeadline = (c: Card, v: number | null) => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(dlKey(c), String(v ?? 0));
  };
  const openRunOf = (c: Card) => runs(db).find((r) => r.card === c && r.stoppedAt === null) ?? null;
  const setStatus = (v: VmRow, status: string) => putVm(db, { ...v, status });
  const isFailing = (v: VmRow) => v.status.startsWith("stopping:"); // a stop call failed or was unconfirmed
  const isStopping = (v: VmRow) => isFailing(v) || v.status.startsWith("hibernating:");
  const reasonOf = (v: VmRow) => (isStopping(v) ? v.status.slice(v.status.indexOf(":") + 1) : "reconciled");
  /** One alarm, from every failing stop and every orphan we could not remove. */
  const syncAlarm = () => setState(db, { alarm: orphans.size || CARDS.some((c) => { const v = getVm(db, c); return v && isFailing(v); }) ? ALARM : detachWarn.size ? DETACH_ALARM : null });

  const mkSteps = (card: Card): Step[] => STEP_IDS.filter((id) => !(card === "boost" && id === "disk")).map((id) => ({ id, state: "wait", startedAt: null, endedAt: null, error: null }));
  /** After a restart the in-memory checklist is gone: rebuild it from the phase, every earlier step ok. */
  function stepsOf(card: Card, status: string): Step[] {
    let arr = steps.get(card);
    if (arr) return arr;
    arr = mkSteps(card);
    const cur = arr.findIndex((x) => x.id === ({ starting: "gpu", warming: "network", ready: "models" } as Record<string, StepId>)[status]); // first step not yet ok
    const t = d.now();
    arr.forEach((x, i) => { if (i <= cur) { x.state = i < cur ? "ok" : status === "ready" ? "wait" : "run"; x.startedAt = t; if (i < cur) x.endedAt = t; } });
    steps.set(card, arr);
    return arr;
  }
  function setStep(card: Card, id: StepId, state: Step["state"], extra: { error?: string; note?: string } = {}) {
    const s = steps.get(card)?.find((x) => x.id === id);
    if (!s || (s.state === state && !extra.error && extra.note === undefined)) return;
    const t = d.now();
    if (state === "run") s.startedAt = t;
    s.startedAt ??= t;
    s.endedAt = state === "ok" || state === "fail" ? t : null;
    s.state = state;
    s.error = extra.error ?? null;
    if (extra.note !== undefined) s.note = extra.note;
  }
  const attach = (card: Card, vmId: string, volume: string) => {
    setStep(card, "disk", "run");
    hs.attachWhenActive(vmId, volume).then(() => setStep(card, "disk", "ok"), (e) => {
      const m = e instanceof Error ? e.message : "unknown";
      console.error("comfy models volume attach failed:", m);
      setStep(card, "disk", "fail", { error: stepError("disk", m) });
    });
  };
  function runSync(card: Card) {
    setStep(card, "models", "run");
    d.sync!(card).then(async (out) => {
      setStep(card, "models", "ok", { note: `fetched ${fetchedCount(out ?? "")} files` });
      if (d.listVolume) saveVolumeList(db, card, await d.listVolume(card));
    }).catch((e) => { // retried on the next boot, or by the models retry
      const m = e instanceof Error ? e.message : "unknown";
      console.error(`[comfy] model sync failed on ${card}:`, m);
      if (steps.get(card)?.find((x) => x.id === "models")?.state !== "ok") setStep(card, "models", "fail", { error: stepError("models", m) });
    });
  }
  function view1(card: Card, boost: EngineView["boost"]): EngineView {
    const now = d.now();
    const vm = getVm(db, card);
    const st = getState(db);
    const all = runs(db);
    const run = openRunOf(card);
    let phase: EngineView["phase"] = "off";
    if (vm && vm.status in PHASE) phase = PHASE[vm.status as keyof typeof PHASE];
    else if (vm && isStopping(vm)) phase = "stopping";
    else if (unavailable.has(card)) phase = "unavailable";
    let st2: Step[] | null = null;
    if (vm && vm.status in PHASE) st2 = stepsOf(card, vm.status);
    else st2 = steps.get(card) ?? null;
    if (st2 && (phase === "stopping" || (!st2.some((x) => x.state === "fail") && phase !== "starting" && phase !== "warming" && phase !== "ready"))) st2 = null;
    if (st2 && phase === "ready" && st2.find((x) => x.id === "models")?.state === "ok") st2 = null;
    return {
      card, phase, gpu: vm?.flavor ?? null, since: run?.startedAt ?? null, usdHr: vm?.usdHr ?? 0,
      runCost: run ? runCost(run, now) : 0, today: spentSince(all, dayStart(now), now), boost,
      keepWarmUntil: st.keepWarmUntil, alarm: st.alarm, deadline: readDeadline(card), kept: vm?.status === "hibernated", steps: st2 && st2.map((x) => ({ ...x })),
    };
  }
  function view() {
    const boost = unavailable.has("boost") ? "unavailable" : getState(db).boost ? "on" : "off";
    return { main: view1("main", boost), boost: view1("boost", boost) } as const;
  }

  async function pick(card: Card): Promise<Offer | null> {
    if (card === "boost") return (await hs.offers(80)).filter((o) => /H100/i.test(o.gpu))[0] ?? null;
    // ponytail: the models volume pins main to its region; no stock there = unavailable (delete the volume to move regions).
    const vol = await hs.findVolume(modelsVolume(card)!.name);
    return (await hs.offers(48)).filter((o) => !vol || o.env === vol.env)[0] ?? null;
  }

  async function warm(card: Card = "main"): Promise<EngineView> {
    try { return await warmInner(card); } finally {
      const why = pendingStop.get(card);
      if (why !== undefined && !busy.has(card)) { pendingStop.delete(card); await stop(card, why); }
    }
  }
  async function warmInner(card: Card): Promise<EngineView> {
    const now = d.now();
    setState(db, { lastActivity: now });
    const out = () => view()[card];
    if (busy.has(card)) return out();
    const vm = getVm(db, card);
    if (vm && vm.status !== "hibernated") return out(); // starting / warming / ready / stopping: nothing to start
    busy.add(card); // also covers the preflight await below
    try {
      steps.set(card, mkSteps(card));
      setStep(card, "links", "run");
      const pf = d.preflight ? await d.preflight(card).catch(() => null) : null; // a failed check must not block a start
      if (pf?.block) { setStep(card, "links", "fail", { error: pf.msg }); throw new Refused(pf.msg); }
      setStep(card, "links", "ok", pf ? { note: pf.msg } : {});
      const ok = canStart({ runs: runs(db), s: readSettings(db), now });
      if (!ok.ok) throw new Refused(ok.why);
      detachWarn.delete(card);
      let row: VmRow;
      let o: Offer | null = null;
      if (vm) {
        try { await hs.restore(vm.vmId); } catch (e) {
          // The hibernated card is out of stock: the models live on the volume, so swap to the cheapest card in stock.
          // ponytail: no swap back once a pricier card is kept; flush to re-pick the cheapest.
          if (!(e instanceof NoCapacity) || !modelsVolume(card) || !(o = await pick(card))) throw e;
          await hs.remove(vm.vmId);
          // Hyperstack can accept the delete of a hibernated VM yet keep it, and the models volume with it: keep the row.
          if ((await hs.status(vm.vmId)) === "HIBERNATED") throw new NoCapacity(`hyperstack ${vm.vmId}: still hibernated after delete`, 409);
          dropVm(db, card);
        }
      }
      if (vm && !o) {
        const vol = modelsVolume(card);
        if (vol) attach(card, vm.vmId, vol.name);
        row = { ...vm, status: "starting" };
      }
      else {
        o ??= await pick(card);
        if (!o) { unavailable.add(card); setStep(card, "gpu", "fail", { error: "No GPU in stock" }); return out(); }
        const secrets = { tsAuthKey: COMFY_TS_AUTHKEY, hfToken: HF_TOKEN, civitaiToken: CIVITAI_TOKEN };
        const vol = modelsVolume(card);
        if (vol) await hs.ensureVolume(vol.name, o.env, vol.gb);
        const id = await hs.create(o, podHost(card), renderCloudInit(card, secrets), HYPERSTACK_KEY_NAME);
        // Background: the pod blocks on the disk, so a failed attach just never reaches ready (the deadline stops it).
        if (vol) attach(card, id, vol.name);
        row = { card, vmId: id, env: o.env, flavor: o.flavor, host: podHost(card), usdHr: o.usdHr, status: "starting" };
      }
      putVm(db, row);
      openRun(db, card, row.vmId, row.usdHr, now);
      setStep(card, "gpu", "run");
      syncAlarm();
      unavailable.delete(card);
      const min = Number(process.env.COMFY_DEV_DEADLINE_MIN);
      writeDeadline(card, min > 0 ? now + min * 60_000 : null);
    } catch (e) {
      if (e instanceof Refused) throw e;
      if (!getVm(db, card)) reconciled = false; // a timed-out create may still exist at Hyperstack: reconcile before the next one
      if (!(e instanceof NoCapacity)) throw e;
      unavailable.add(card);
      setStep(card, "gpu", "fail", { error: "No GPU in stock" });
    } finally {
      busy.delete(card);
    }
    return out();
  }

  /** Never throws. Serialized per card; deferred while a warm() for the card is in flight. */
  function stop(card: Card, reason: string): Promise<void> {
    if (busy.has(card)) { pendingStop.set(card, reason); return Promise.resolve(); }
    const p = (locks.get(card) ?? Promise.resolve()).then(() => stopNow(card, reason));
    locks.set(card, p.catch(() => {})); // one failure must not block later stops

    return p;
  }
  async function stopNow(card: Card, reason: string): Promise<void> {
    if (card === "boost") setState(db, { boost: false }); // any stop: the next job runs on main until boost is turned on again
    const vm = getVm(db, card);
    if (!vm || (vm.status === "hibernated" && reason !== "flush")) return;
    const finish = (hibernated: boolean) => {
      hibSince.delete(card);
      steps.delete(card);
      closeRun(db, card, d.now(), reason);
      if (hibernated) setStatus(vm, "hibernated"); else { dropVm(db, card); writeDeadline(card, null); detachWarn.delete(card); }
    };
    try {
      const del = reason === "flush"; // every other stop hibernates, keeping the models on disk
      const s = await hs.status(vm.vmId);
      if (s === null) finish(false); // already gone
      else if (del) { await hs.remove(vm.vmId); finish(false); }
      else if (s === "HIBERNATED") finish(true);
      else if (TRANSITIONAL.has(s) && d.now() - (hibSince.get(card) ?? d.now()) < 10 * 60_000) {
        // Hyperstack answers 426 to a hibernate mid-transition: wait for the tick to re-enter once it settles (or after 10 min, hibernate anyway).
        if (!hibSince.has(card)) hibSince.set(card, d.now());
        if (!isStopping(vm)) console.log(`[comfy] ${card} stop deferred: VM is ${s}`);
        setStatus(vm, `stopping:${reason}`);
        return;
      } else {
        // hibernate detaches the models volume: unmount it first or ext4 aborts its journal mid-write. Unreachable pod: hibernate anyway, billing wins.
        if (modelsVolume(card) && d.release) await d.release(card).catch((e) => console.warn("comfy models unmount failed:", e instanceof Error ? e.message : "unknown"));
        const h = await hs.hibernate(vm.vmId, modelsVolume(card)?.name);
        if (h?.detached === false && modelsVolume(card)) detachWarn.add(card);
        if ((await hs.status(vm.vmId)) === "HIBERNATED") finish(true); else { if (!isStopping(vm)) hibSince.set(card, d.now()); setStatus(vm, `${isStopping(vm) ? "stopping" : "hibernating"}:${reason}`); } // tick confirms; a retry that is still unconfirmed keeps the alarm
      }
    } catch {
      setStatus(vm, `stopping:${reason}`);
    }
    syncAlarm();
  }

  async function tick(): Promise<void> {
    const now = d.now();
    if (!busy.size) { // a warm in flight has a VM at Hyperstack that the db doesn't know yet
      if (!reconciled || ++tickN % 10 === 0) await reconcile().catch(() => {}); // boot reconcile may fail; keep trying
      await retryOrphans();
    }
    for (const card of CARDS) {
      if (busy.has(card)) continue;
      let vm = getVm(db, card);
      if (!vm || vm.status === "hibernated") continue;
      if (isFailing(vm)) { await stop(card, reasonOf(vm)); continue; }
      try {
        const s = await hs.status(vm.vmId);
        if (s === null) { closeRun(db, card, now, isStopping(vm) ? reasonOf(vm) : "vanished"); dropVm(db, card); writeDeadline(card, null); continue; }
        if (s === "HIBERNATED") { closeRun(db, card, now, reasonOf(vm)); setStatus(vm, "hibernated"); continue; }
        if (isStopping(vm)) { // hibernate was accepted: confirm, else retry
          if (!hibSince.has(card)) hibSince.set(card, now);
          const stuck = now - hibSince.get(card)! > 10 * 60_000; // HIBERNATING for too long
          if (stuck || s === "ACTIVE" || s === "ERROR" || s === "SHUTOFF") { setStatus(vm, `stopping:${reasonOf(vm)}`); syncAlarm(); await stop(card, reasonOf(vm)); }
          continue;
        }
        if (s === "SHUTOFF") { await stop(card, "shutoff"); continue; } // still bills
        stepsOf(card, vm.status);
        let next = "starting";
        if (s === "ERROR") setStep(card, "gpu", "fail", { error: "The VM went into ERROR" });
        if (s === "ACTIVE") {
          setStep(card, "gpu", "ok");
          const ip = d.resolve ? await d.resolve(podHost(card)).catch(() => null) : null;
          if (ip) addr.set(card, ip); else addr.delete(card);
          setStep(card, "network", ip ? "ok" : "run");
          next = (await d.ping(base(card)).catch(() => false)) ? "ready" : "warming";
          setStep(card, "comfy", next === "ready" ? "ok" : "run");
          setStep(card, "ready", next === "ready" ? "ok" : "wait");
        }
        if (next === "ready" && vm.status !== "ready") setState(db, { lastActivity: now }); // idle counts from ready, not from the warm click
        if (next !== vm.status) { setStatus(vm, next); vm = { ...vm, status: next }; }
        if (next === "ready" && d.sync && !synced.has(card)) { synced.add(card); runSync(card); }
        if (next !== "ready") { synced.delete(card); setStep(card, "models", "wait"); }
      } catch { if (isStopping(vm)) continue; /* status flaked: still evaluate the stop policy below */ }
      // A cold boot downloads ~80 GB: booting counts as busy for up to WARM_MAX_MS, then idle may stop a pod that never came up.
      const run = runs(db).find((r) => r.card === card && r.stoppedAt === null);
      const booting = vm.status !== "ready" && !!run && now - run.startedAt < WARM_MAX_MS;
      if (card === "main" && vm.status === "ready" && training()) await trainStatus(host(card)).catch((e) => console.error("[comfy] train status failed:", e)); // ends the run even with the app closed
      const busyJob = booting || (card === "main" && training()) || !!db.prepare("SELECT 1 FROM comfy_jobs WHERE status = 'running' AND card = ?").get(card);
      const st = getState(db);
      const why = stopReason({ runs: runs(db), s: readSettings(db), lastActivity: st.lastActivity, keepWarmUntil: st.keepWarmUntil, busy: busyJob, deadline: readDeadline(card), now });
      if (why) await stop(card, why);
    }
  }

  /** Boot: kill labelled VMs the db doesn't know; adopt the ones it does. */
  async function reconcile(): Promise<void> {
    const ours = await hs.listOurs();
    reconciled = true;
    const known = new Set(CARDS.map((c) => getVm(db, c)?.vmId));
    for (const o of ours) {
      if (known.has(o.id) || o.status === "HIBERNATED" || o.status === "DELETING") continue;
      try { await hs.remove(o.id); orphans.delete(o.id); } catch { orphans.add(o.id); }
    }
    for (const card of CARDS) {
      const vm = getVm(db, card);
      if (!vm) continue;
      const o = ours.find((x) => x.id === vm.vmId);
      if (!o) { closeRun(db, card, d.now(), "vanished"); dropVm(db, card); continue; }
      if (o.status === "HIBERNATED") { closeRun(db, card, d.now(), reasonOf(vm)); setStatus(vm, "hibernated"); }
      else if (o.status === "ACTIVE" && (vm.status === "hibernated" || vm.status === "starting")) {
        setStatus(vm, "warming");
        if (!openRunOf(card)) openRun(db, card, vm.vmId, vm.usdHr, d.now());
      }
    }
    syncAlarm();
  }

  async function retryOrphans(): Promise<void> {
    for (const id of [...orphans]) { try { await hs.remove(id); orphans.delete(id); } catch { /* still billing; alarm stays */ } }
    syncAlarm();
  }

  function keepWarm(until: number): EngineView {
    const now = d.now();
    setState(db, { keepWarmUntil: clampKeepWarm(until, readSettings(db), now), lastActivity: now });
    return view().main;
  }

  async function setBoost(on: boolean): Promise<EngineView> {
    setState(db, { boost: on });
    if (on) {
      unavailable.delete("boost");
      try { await warm("boost"); } catch (e) { setState(db, { boost: false }); throw e; }
    } else await stop("boost", "manual");
    return view().boost;
  }

  /** Re-runs one failed step; never recreates the VM. */
  async function retry(card: Card, step: StepId): Promise<EngineView> {
    const vm = getVm(db, card);
    const live = vm && vm.status !== "hibernated";
    if (step === "links") return warm(card); // re-runs the preflight, then starts if it passes
    if (step === "gpu" && vm?.status === "hibernated") return warm(card);
    if (step === "disk" && live && modelsVolume(card)) attach(card, vm.vmId, modelsVolume(card)!.name);
    if (step === "network" || step === "comfy") setStep(card, step, "wait"); // the tick re-evaluates
    if (step === "models") { synced.delete(card); setStep(card, "models", "wait"); }
    return view()[card];
  }

  return { warm, retry, keepWarm, setBoost, stop, tick, reconcile, view, base, host };
}

type Engine = ReturnType<typeof engine>;
export function getEngine(): Engine {
  const g = globalThis as { __comfyEngine?: Engine };
  if (g.__comfyEngine) return g.__comfyEngine;
  const db = comfyDb();
  const e: Engine = engine({ db, hs: hyperstack(HYPERSTACK_API_KEY), ping: (b) => ping(b), now: Date.now, resolve: (h) => tailnetIp(h),
    sync: async (c) => { const h = e.host(c); await waitSsh(h); const out = await withRetry(() => syncModels(c, h), isNetError); if (c === "main") await pushLoras(h); dropModels(); return out; },
    release: (c) => releaseModels(c, e.host(c)),
    listVolume: (c) => listVolume(e.host(c)),
    // The Krea2 link is dead upstream and a fresh deploy has no saved volume list yet, so main only warns until its first sync has recorded what the volume holds.
    preflight: async (c) => {
      const dead = await preflight(c, { db, manifest: readManifest(), head: headUrl, now: Date.now() });
      return dead.length ? { msg: deadMessage(dead), block: !(c === "main" && getJson(db, "volume.main") == null) } : null;
    } });
  return (g.__comfyEngine = e);
}
