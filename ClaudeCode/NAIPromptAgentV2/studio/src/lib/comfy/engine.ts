import type Database from "better-sqlite3";
import { type Card, type VmRow, comfyDb, getVm, putVm, dropVm, openRun, closeRun, runs, readSettings, getState, setState } from "./store";
import { type Hyperstack, type Offer, NoCapacity, hyperstack } from "./hyperstack";
import { canStart, clampKeepWarm, dayStart, runCost, spentSince, stopReason } from "./spend";
import { COMFY_PORT, podHost, renderCloudInit } from "./pod";
import { ping } from "./client";
import { COMFY_TS_AUTHKEY, CIVITAI_TOKEN, HF_TOKEN, HYPERSTACK_API_KEY, HYPERSTACK_KEY_NAME } from "@/lib/env";

export type EngineView = {
  card: Card; phase: "off" | "starting" | "warming" | "ready" | "stopping" | "unavailable"; gpu: string | null; since: number | null;
  usdHr: number; runCost: number; today: number; boost: "off" | "on" | "unavailable"; keepWarmUntil: number; alarm: string | null; deadline: number | null;
};
export type Deps = { db: Database.Database; hs: Hyperstack; ping: (base: string) => Promise<boolean>; now: () => number };
/** warm() refused by the spend policy; `message` is the user-facing sentence. */
export class Refused extends Error {}

const ALARM = "GPU still billing — retrying stop";
const CARDS: Card[] = ["main", "boost"];
const PHASE = { starting: "starting", warming: "warming", ready: "ready" } as const;

export function engine(d: Deps) {
  const { db, hs } = d;
  const unavailable = new Set<Card>();
  const busy = new Set<Card>(); // a warm call is mid-flight for this card
  const pendingStop = new Map<Card, string>(); // stop requested while warm() was in flight
  const locks = new Map<Card, Promise<void>>(); // stops are serialized per card
  const orphans = new Set<string>(); // labelled VMs the db doesn't know whose remove failed
  const hibSince = new Map<Card, number>(); // when a hibernate was accepted but not yet confirmed
  let reconciled = false;
  let tickN = 0;
  const base = (card: Card) => `http://${podHost(card)}:${COMFY_PORT}`;
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
  const syncAlarm = () => setState(db, { alarm: orphans.size || CARDS.some((c) => { const v = getVm(db, c); return v && isFailing(v); }) ? ALARM : null });

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
    return {
      card, phase, gpu: vm?.flavor ?? null, since: run?.startedAt ?? null, usdHr: vm?.usdHr ?? 0,
      runCost: run ? runCost(run, now) : 0, today: spentSince(all, dayStart(now), now), boost,
      keepWarmUntil: st.keepWarmUntil, alarm: st.alarm, deadline: readDeadline(card),
    };
  }
  function view() {
    const boost = unavailable.has("boost") ? "unavailable" : getState(db).boost ? "on" : "off";
    return { main: view1("main", boost), boost: view1("boost", boost) } as const;
  }

  async function pick(card: Card): Promise<Offer | null> {
    const list = card === "boost" ? (await hs.offers(80)).filter((o) => /H100/i.test(o.gpu)) : await hs.offers(48);
    return list[0] ?? null;
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
    const ok = canStart({ runs: runs(db), s: readSettings(db), now });
    if (!ok.ok) throw new Refused(ok.why);
    busy.add(card);
    try {
      let row: VmRow;
      if (vm) {
        await hs.restore(vm.vmId);
        row = { ...vm, status: "starting" };
      } else {
        const o = await pick(card);
        if (!o) { unavailable.add(card); return out(); }
        const secrets = { tsAuthKey: COMFY_TS_AUTHKEY, hfToken: HF_TOKEN, civitaiToken: CIVITAI_TOKEN };
        const id = await hs.create(o, podHost(card), renderCloudInit(card, secrets), HYPERSTACK_KEY_NAME);
        row = { card, vmId: id, env: o.env, flavor: o.flavor, host: podHost(card), usdHr: o.usdHr, status: "starting" };
      }
      putVm(db, row);
      openRun(db, card, row.vmId, row.usdHr, now);
      unavailable.delete(card);
      const min = Number(process.env.COMFY_DEV_DEADLINE_MIN);
      writeDeadline(card, min > 0 ? now + min * 60_000 : null);
    } catch (e) {
      if (!(e instanceof NoCapacity)) throw e;
      unavailable.add(card);
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
    const vm = getVm(db, card);
    if (!vm || vm.status === "hibernated") return;
    const finish = (hibernated: boolean) => {
      hibSince.delete(card);
      closeRun(db, card, d.now(), reason);
      if (hibernated) setStatus(vm, "hibernated"); else { dropVm(db, card); writeDeadline(card, null); }
    };
    try {
      const del = reason === "deadline" || Number(process.env.COMFY_DEV_DEADLINE_MIN) > 0; // dev run leaves nothing behind
      const s = await hs.status(vm.vmId);
      if (s === null) finish(false); // already gone
      else if (del) { await hs.remove(vm.vmId); finish(false); }
      else if (s === "HIBERNATED") finish(true);
      else {
        await hs.hibernate(vm.vmId);
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
        let next = "starting";
        if (s === "ACTIVE") next = (await d.ping(base(card)).catch(() => false)) ? "ready" : "warming";
        if (next !== vm.status) { setStatus(vm, next); vm = { ...vm, status: next }; }
      } catch { if (isStopping(vm)) continue; /* status flaked: still evaluate the stop policy below */ }
      const busyJob = !!db.prepare("SELECT 1 FROM comfy_jobs WHERE status = 'running' AND card = ?").get(card);
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
    if (on) { unavailable.delete("boost"); await warm("boost"); } else await stop("boost", "manual");
    return view().boost;
  }

  return { warm, keepWarm, setBoost, stop, tick, reconcile, view, base };
}

type Engine = ReturnType<typeof engine>;
export function getEngine(): Engine {
  const g = globalThis as { __comfyEngine?: Engine };
  return (g.__comfyEngine ??= engine({ db: comfyDb(), hs: hyperstack(HYPERSTACK_API_KEY), ping: (b) => ping(b), now: Date.now }));
}
