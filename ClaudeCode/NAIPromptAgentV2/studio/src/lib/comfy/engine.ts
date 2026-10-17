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
  const busy = new Set<Card>(); // a warm/stop call is mid-flight for this card
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
  const isStopping = (v: VmRow) => v.status.startsWith("stopping:");

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

  /** Never throws: a failed stop leaves the VM row as `stopping:<reason>` and the alarm up, and tick() retries. */
  async function stop(card: Card, reason: string): Promise<void> {
    const vm = getVm(db, card);
    if (!vm || vm.status === "hibernated") return;
    try {
      if (reason === "deadline") await hs.remove(vm.vmId); else await hs.hibernate(vm.vmId);
    } catch {
      setStatus(vm, `stopping:${reason}`);
      setState(db, { alarm: ALARM });
      return;
    }
    closeRun(db, card, d.now(), reason);
    if (reason === "deadline") { dropVm(db, card); writeDeadline(card, null); } else setStatus(vm, "hibernated");
    if (!CARDS.some((c) => { const v = getVm(db, c); return v && isStopping(v); })) setState(db, { alarm: null });
  }

  async function tick(): Promise<void> {
    const now = d.now();
    for (const card of CARDS) {
      if (busy.has(card)) continue;
      let vm = getVm(db, card);
      if (!vm || vm.status === "hibernated") continue;
      if (isStopping(vm)) { await stop(card, vm.status.slice("stopping:".length)); continue; }
      try {
        const s = await hs.status(vm.vmId);
        if (s === null) { closeRun(db, card, now, "vanished"); dropVm(db, card); continue; }
        if (s === "HIBERNATED") { closeRun(db, card, now, "reconciled"); setStatus(vm, "hibernated"); continue; }
        if (s === "SHUTOFF") { await stop(card, "shutoff"); continue; } // still bills
        let next = "starting";
        if (s === "ACTIVE") next = (await d.ping(base(card)).catch(() => false)) ? "ready" : "warming";
        if (next !== vm.status) { setStatus(vm, next); vm = { ...vm, status: next }; }
      } catch { /* status flaked: still evaluate the stop policy below */ }
      const busyJob = !!db.prepare("SELECT 1 FROM comfy_jobs WHERE status = 'running' AND card = ?").get(card);
      const st = getState(db);
      const why = stopReason({ runs: runs(db), s: readSettings(db), lastActivity: st.lastActivity, keepWarmUntil: st.keepWarmUntil, busy: busyJob, deadline: readDeadline(card), now });
      if (why) await stop(card, why);
    }
  }

  /** Boot: kill labelled VMs the db doesn't know; adopt the ones it does. */
  async function reconcile(): Promise<void> {
    const ours = await hs.listOurs();
    const known = new Set(CARDS.map((c) => getVm(db, c)?.vmId));
    for (const o of ours) {
      if (known.has(o.id) || o.status === "HIBERNATED" || o.status === "DELETING") continue;
      try { await hs.remove(o.id); } catch { setState(db, { alarm: ALARM }); }
    }
    for (const card of CARDS) {
      const vm = getVm(db, card);
      if (!vm) continue;
      const o = ours.find((x) => x.id === vm.vmId);
      if (!o) { closeRun(db, card, d.now(), "vanished"); dropVm(db, card); continue; }
      if (o.status === "HIBERNATED") { closeRun(db, card, d.now(), "reconciled"); setStatus(vm, "hibernated"); }
      else if (o.status === "ACTIVE" && (vm.status === "hibernated" || vm.status === "starting")) {
        setStatus(vm, "warming");
        if (!openRunOf(card)) openRun(db, card, vm.vmId, vm.usdHr, d.now());
      }
    }
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
