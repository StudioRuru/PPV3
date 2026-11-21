import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { engine, Refused } from "./engine";
import { migrate, getVm, runs, writeSettings, addJob, updateJob } from "./store";
import { NoCapacity, type Hyperstack, type Offer } from "./hyperstack";

const H = 3_600_000;
const T0 = new Date(2026, 5, 15, 12, 0).getTime();
const main: Offer = { env: "e", region: "r", flavor: "f48", gpu: "L40", vramGb: 48, usdHr: 1 };
const h100: Offer = { env: "e", region: "r", flavor: "fh", gpu: "H100-80G-PCIe", vramGb: 80, usdHr: 2 };
const a100: Offer = { env: "e", region: "r", flavor: "fa", gpu: "A100-80G-PCIe", vramGb: 80, usdHr: 1.5 };

function setup(offers: Offer[] = [main, h100], resolve?: (h: string) => Promise<string | null>, sync?: (card: string) => Promise<string>, release?: (card: string) => Promise<unknown>, extra: Partial<Parameters<typeof engine>[0]> = {}) {
  const db = new Database(":memory:");
  migrate(db);
  let now = T0;
  const log: string[] = [];
  const vms = new Map<string, string>(); // id -> status
  const o = { stopFails: false, pingOk: false, offers, noop: false, listFails: false, removeFails: false, restoreFails: false, removeNoop: false, gate: null as Promise<void> | null, vol: null as { env: string } | null, vols: [] as string[], createStatus: "BUILD", detached: true, restoreErr: null as Error | null };
  let n = 0;
  const hs = {
    offers: async (min: number) => o.offers.filter((x) => x.vramGb >= min).sort((a, b) => a.usdHr - b.usdHr),
    create: async (_o: Offer, name: string) => { if (o.gate) await o.gate; const id = `vm${++n}`; vms.set(id, o.createStatus); log.push(`create ${name}`); o.vols.push(`create ${_o.env}`); return id; },
    attachWhenActive: async (id: string, vol: string) => { o.vols.push(`attach ${id} ${vol}`); },
    findVolume: async () => o.vol,
    ensureVolume: async (name: string, env: string, gb: number) => { o.vols.push(`ensure ${name} ${env} ${gb}`); },
    status: async (id: string) => vms.get(id) ?? null,
    hibernate: async (id: string) => { if (o.stopFails) throw new Error("boom"); if (!o.noop) vms.set(id, "HIBERNATED"); log.push(`hibernate ${id}`); return { detached: o.detached }; },
    restore: async (id: string) => { if (o.restoreErr) throw o.restoreErr; if (o.restoreFails) throw new NoCapacity("Not Enough Stock", 400); vms.set(id, o.createStatus); log.push(`restore ${id}`); },
    start: async () => {},
    remove: async (id: string) => { if (o.removeFails) throw new Error("rm"); if (!o.removeNoop) vms.delete(id); log.push(`remove ${id}`); },
    listOurs: async () => { if (o.listFails) throw new Error("ls"); return [...vms].map(([id, status]) => ({ id, status })); },
  } as unknown as Hyperstack;
  const pinged: string[] = [];
  const e = engine({ db, hs, ping: async (b) => { pinged.push(b); return o.pingOk; }, now: () => now, resolve, sync, release, ...extra });
  return { db, e, vms, log, o, pinged, tick: (ms: number) => { now += ms; }, at: () => now };
}

test("first warm creates once and opens a run; second warm while starting is a no-op", async () => {
  const s = setup();
  const v = await s.e.warm();
  assert.equal(v.phase, "starting");
  await s.e.warm();
  assert.deepEqual(s.log, ["create nai-comfy-main"]);
  assert.equal(runs(s.db).length, 1);
  assert.equal(runs(s.db)[0].usdHr, 1);
});

test("main ensures its models volume and stays in the volume's region; boost has none", async () => {
  const s = setup([{ ...main, env: "cheap", usdHr: 0.5 }, { ...main, env: "vol" }, h100]);
  s.o.vol = { env: "vol" };
  await s.e.warm();
  assert.deepEqual(s.o.vols, ["ensure nai-comfy-main-models vol 150", "create vol", "attach vm1 nai-comfy-main-models"]);
  s.o.vols.length = 0;
  await s.e.setBoost(true);
  assert.deepEqual(s.o.vols, ["create e"]);
});

test("pings the resolved tailnet IP, falling back to the MagicDNS name", async () => {
  let ip: string | null = "100.0.0.2";
  const s = setup(undefined, async () => ip);
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  assert.equal(s.e.base("main"), "http://100.0.0.2:8188");
  ip = null;
  await s.e.tick();
  assert.deepEqual(s.pinged, ["http://100.0.0.2:8188", "http://nai-comfy-main:8188"]);
});

test("a cold boot is not idle-stopped until 90 min; idle then counts from ready", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.tick(60 * 60_000); // past idleMin (50) while still warming
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "warming");
  s.o.pingOk = true;
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "ready");
  s.tick(40 * 60_000);
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "ready");
  s.tick(11 * 60_000);
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "off");
});

test("a pod that never comes up is idle-stopped after 90 min", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.tick(91 * 60_000);
  await s.e.tick();
  assert.notEqual(s.e.view().main.phase, "warming");
});

test("warm on a hibernated VM restores instead of creating", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  await s.e.warm();
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().main.phase, "off");
  const v = await s.e.warm();
  assert.equal(v.phase, "starting");
  assert.deepEqual(s.log, ["create nai-comfy-main", "hibernate vm1", "restore vm1"]);
  assert.equal(runs(s.db).length, 2);
});

test("hibernated card out of stock: swaps to the cheapest in-stock card on the same volume", async () => {
  const s = setup([main, a100]);
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  s.o.vol = { env: "e" };
  await s.e.warm();
  await s.e.stop("main", "manual");
  s.o.offers = [a100];
  s.o.vols.length = 0;
  s.o.restoreFails = true;
  const v = await s.e.warm();
  assert.equal(v.phase, "starting");
  assert.equal(v.gpu, "fa");
  assert.deepEqual(s.log, ["create nai-comfy-main", "hibernate vm1", "remove vm1", "create nai-comfy-main"]);
  assert.deepEqual(s.o.vols, ["ensure nai-comfy-main-models e 150", "create e", "attach vm2 nai-comfy-main-models"]);
});

test("swap whose delete Hyperstack ignores keeps the hibernated row and goes unavailable", async () => {
  const s = setup([main, a100]);
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  s.o.vol = { env: "e" };
  await s.e.warm();
  await s.e.stop("main", "manual");
  s.o.offers = [a100];
  s.o.restoreFails = true;
  s.o.removeNoop = true;
  const v = await s.e.warm();
  assert.equal(v.phase, "unavailable");
  assert.equal(v.kept, true);
  assert.equal(getVm(s.db, "main")?.vmId, "vm1");
  assert.deepEqual(s.log, ["create nai-comfy-main", "hibernate vm1", "remove vm1"]);
});

test("restore re-attaches the models volume detached at hibernate", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  s.o.vol = { env: "e" };
  await s.e.warm();
  await s.e.stop("main", "manual");
  s.o.vols.length = 0;
  await s.e.warm();
  assert.deepEqual(s.o.vols, ["attach vm1 nai-comfy-main-models"]);
});

test("hibernate unmounts the models volume before Hyperstack detaches it; an unreachable pod still hibernates", async () => {
  const order: string[] = [];
  const s = setup(undefined, undefined, undefined, async (c) => { order.push(`release ${c}`); });
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  await s.e.warm();
  s.log.length = 0;
  await s.e.stop("main", "manual");
  assert.deepEqual([...order, ...s.log], ["release main", "hibernate vm1"]);
  await s.e.setBoost(true);
  await s.e.stop("boost", "manual");
  assert.deepEqual(order, ["release main"]); // boost has no volume
  const u = setup(undefined, undefined, undefined, async () => { throw new Error("ssh"); });
  u.o.createStatus = "ACTIVE";
  await u.e.warm();
  await u.e.stop("main", "manual");
  assert.equal(u.vms.get("vm1"), "HIBERNATED");
});

test("hibernated card out of stock with nothing else in stock stays kept and unavailable", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  await s.e.warm();
  await s.e.stop("main", "manual");
  s.o.offers = [];
  s.o.restoreFails = true;
  const v = await s.e.warm();
  assert.equal(v.phase, "unavailable");
  assert.equal(v.kept, true);
  assert.deepEqual(s.log, ["create nai-comfy-main", "hibernate vm1"]);
});

test("phase goes starting -> warming -> ready across ticks", async () => {
  const s = setup();
  await s.e.warm();
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "starting");
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "warming");
  s.o.pingOk = true;
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "ready");
});

test("a pod that comes up syncs its model manifest once, and again after a reboot", async () => {
  const synced: string[] = [];
  const s = setup(undefined, undefined, async (c) => { synced.push(c); throw new Error("ssh"); });
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.pingOk = true;
  await s.e.tick();
  await s.e.tick();
  assert.deepEqual(synced, ["main"], "once per boot, even when it fails");
  s.o.pingOk = false;
  await s.e.tick();
  s.o.pingOk = true;
  await s.e.tick();
  assert.deepEqual(synced, ["main", "main"]);
});

test("idle tick hibernates and closes the run with reason idle", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.pingOk = true;
  await s.e.tick();
  s.tick(51 * 60_000);
  await s.e.tick();
  assert.equal(s.vms.get("vm1"), "HIBERNATED");
  assert.equal(runs(s.db)[0].stopReason, "idle");
  assert.equal(s.e.view().main.phase, "off");
});

test("a running job defers idle stop", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  const id = addJob(s.db, "photo", {}, "main", s.at());
  updateJob(s.db, id, { status: "running" });
  s.tick(51 * 60_000);
  await s.e.tick();
  assert.equal(s.vms.get("vm1"), "ACTIVE");
});

test("deadline hibernates, keeping the models", async () => {
  process.env.COMFY_DEV_DEADLINE_MIN = "5";
  const s = setup();
  try { await s.e.warm(); } finally { delete process.env.COMFY_DEV_DEADLINE_MIN; }
  assert.equal(s.e.view().main.deadline, s.at() + 5 * 60_000);
  s.vms.set("vm1", "ACTIVE");
  s.tick(6 * 60_000);
  await s.e.tick();
  assert.equal(s.vms.get("vm1"), "HIBERNATED");
  assert.equal(s.e.view().main.kept, true);
  assert.equal(runs(s.db)[0].stopReason, "deadline");
});

test("flush deletes a hibernated VM; a later flush is a no-op", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().main.kept, true);
  await s.e.stop("main", "flush");
  assert.equal(s.vms.has("vm1"), false);
  assert.equal(getVm(s.db, "main"), null);
  assert.equal(s.e.view().main.kept, false);
  await s.e.stop("main", "flush");
});

test("failed stop sets alarm and the next tick retries and clears it", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.stopFails = true;
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().main.alarm, "GPU still billing — retrying stop");
  assert.equal(s.e.view().main.phase, "stopping");
  assert.equal(runs(s.db)[0].stoppedAt, null);
  await s.e.tick(); // still failing
  assert.ok(s.e.view().main.alarm);
  s.o.stopFails = false;
  await s.e.tick();
  assert.equal(s.vms.get("vm1"), "HIBERNATED");
  assert.equal(s.e.view().main.alarm, null);
  assert.equal(runs(s.db)[0].stopReason, "manual");
});

test("reconcile deletes a labelled VM the db doesn't know", async () => {
  const s = setup();
  s.vms.set("orphan", "ACTIVE");
  await s.e.reconcile();
  assert.equal(s.vms.has("orphan"), false);
  assert.deepEqual(s.log, ["remove orphan"]);
});

test("reconcile adopts a known VM and drops one that vanished", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "HIBERNATED");
  await s.e.reconcile();
  assert.equal(getVm(s.db, "main")?.status, "hibernated");
  assert.equal(runs(s.db)[0].stopReason, "reconciled");
  s.vms.delete("vm1");
  await s.e.reconcile();
  assert.equal(getVm(s.db, "main"), null);
});

test("warm refused at daily cap with the canStart sentence", async () => {
  const s = setup();
  writeSettings(s.db, { dailyCapUsd: 1 });
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.tick(2 * H);
  await s.e.stop("main", "manual");
  await assert.rejects(s.e.warm(), (err: Error) => err instanceof Refused && /Today's GPU cap \(\$1\) is used up/.test(err.message));
});

test("keepWarm clamps and defers idle stop", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  const v = s.e.keepWarm(s.at() + 99 * H);
  assert.equal(v.keepWarmUntil, s.at() + 6 * H);
  s.tick(60 * 60_000);
  await s.e.tick();
  assert.equal(s.vms.get("vm1"), "ACTIVE");
});

test("boost with no H100 offer -> boost unavailable, main unaffected", async () => {
  const s = setup([main, a100]);
  const v = await s.e.setBoost(true);
  assert.equal(v.boost, "unavailable");
  assert.equal(s.e.view().boost.phase, "unavailable");
  assert.equal(s.log.length, 0);
  const m = await s.e.warm("main");
  assert.equal(m.phase, "starting");
  assert.equal(s.e.view().main.boost, "unavailable");
});

test("boost picks an H100 and boost off stops it", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  const v = await s.e.setBoost(true);
  assert.equal(v.boost, "on");
  assert.equal(getVm(s.db, "boost")?.flavor, "fh");
  assert.equal(runs(s.db)[0].usdHr, 2);
  await s.e.setBoost(false);
  assert.equal(s.e.view().boost.phase, "off");
  assert.equal(runs(s.db)[0].stopReason, "manual");
});

test("NoCapacity on create marks unavailable", async () => {
  const s = setup();
  const db = s.db;
  const hs = { offers: async () => [main], findVolume: async () => null, ensureVolume: async () => {}, create: async () => { throw new NoCapacity("capacity", 400); } } as unknown as Hyperstack;
  const e = engine({ db, hs, ping: async () => false, now: () => T0 });
  assert.equal((await e.warm()).phase, "unavailable");
});

test("reconcile retried by tick after listOurs failed at boot", async () => {
  const s = setup();
  s.vms.set("orphan", "ACTIVE");
  s.o.listFails = true;
  await s.e.tick();
  assert.equal(s.vms.has("orphan"), true);
  s.o.listFails = false;
  await s.e.tick();
  assert.equal(s.vms.has("orphan"), false);
});

test("orphan remove failure keeps the alarm across another card's good stop until it succeeds", async () => {
  const s = setup();
  await s.e.warm("main");
  s.vms.set("vm1", "ACTIVE");
  s.vms.set("orphan", "ACTIVE");
  s.o.removeFails = true;
  await s.e.reconcile();
  assert.ok(s.e.view().main.alarm);
  await s.e.stop("main", "manual");
  assert.ok(s.e.view().main.alarm, "orphan keeps alarm");
  s.o.removeFails = false;
  await s.e.tick();
  assert.equal(s.vms.has("orphan"), false);
  assert.equal(s.e.view().main.alarm, null);
});

test("hibernate accepted but VM stays ACTIVE -> tick retries with alarm", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.noop = true;
  await s.e.stop("main", "manual");
  assert.equal(getVm(s.db, "main")?.status, "hibernating:manual");
  assert.equal(runs(s.db)[0].stoppedAt, null);
  await s.e.tick();
  assert.equal(s.e.view().main.alarm, "GPU still billing — retrying stop");
  assert.equal(s.log.filter((l) => l.startsWith("hibernate")).length, 2);
  s.o.noop = false;
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "off");
  assert.equal(s.e.view().main.alarm, null);
});

test("retry when the VM is already HIBERNATED succeeds and allows warm again", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.stopFails = true;
  await s.e.stop("main", "manual");
  s.vms.set("vm1", "HIBERNATED"); // hibernate actually took effect
  await s.e.tick();
  assert.equal(s.e.view().main.alarm, null);
  assert.equal(runs(s.db)[0].stopReason, "manual");
  assert.equal((await s.e.warm()).phase, "starting");
});

test("stop during an in-flight warm runs right after create returns", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  let release!: () => void;
  s.o.gate = new Promise<void>((r) => (release = r));
  const w = s.e.warm();
  await s.e.stop("main", "manual"); // deferred
  release();
  await w;
  assert.equal(s.vms.get("vm1"), "HIBERNATED");
  assert.equal(s.e.view().main.phase, "off");
});

test("dev deadline env still hibernates on a non-deadline stop", async () => {
  const s = setup();
  s.o.createStatus = "ACTIVE"; // a VM in BUILD is transitional: stop waits for the tick
  process.env.COMFY_DEV_DEADLINE_MIN = "30";
  try { await s.e.warm(); await s.e.stop("main", "manual"); } finally { delete process.env.COMFY_DEV_DEADLINE_MIN; }
  assert.equal(s.vms.get("vm1"), "HIBERNATED");
  assert.equal(getVm(s.db, "main")?.status, "hibernated");
});

test("an idle stop of boost clears the boost flag; a manual stop of main does not", async () => {
  const s = setup();
  await s.e.setBoost(true);
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().boost.boost, "on");
  await s.e.stop("boost", "idle");
  assert.equal(s.e.view().boost.boost, "off");
});

test("a manual stop of boost clears the boost flag too", async () => {
  const s = setup();
  await s.e.setBoost(true);
  await s.e.stop("boost", "manual");
  assert.equal(s.e.view().boost.boost, "off");
});

test("setBoost(true) rolls the flag back when the warm is refused", async () => {
  const s = setup();
  writeSettings(s.db, { budgetUsd: 1 });
  await s.e.warm();
  s.tick(2 * H);
  await s.e.stop("main", "manual");
  await assert.rejects(s.e.setBoost(true), (err: Error) => err instanceof Refused);
  assert.equal(s.e.view().boost.boost, "off");
});

test("reconcile tick during an in-flight create does not remove the new VM", async () => {
  const s = setup();
  let release!: () => void;
  s.o.gate = new Promise<void>((r) => (release = r));
  const w = s.e.warm();
  await new Promise((r) => setImmediate(r));
  s.vms.set("vm9", "ACTIVE"); // exists at Hyperstack, row not written yet
  await s.e.tick();
  assert.equal(s.vms.has("vm9"), true);
  release();
  await w;
});

test("a stop error does not block later stops for the card", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  const real = s.db.prepare.bind(s.db);
  let boom = 2;
  (s.db as unknown as { prepare: unknown }).prepare = (q: string) => { if (boom > 0 && /UPDATE comfy_runs|INSERT OR REPLACE INTO comfy_vms/.test(q)) { boom--; throw new Error("db"); } return real(q); };
  await assert.rejects(s.e.stop("main", "manual"));
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().main.phase, "off");
});

test("hibernating for over 10 minutes raises the alarm and retries", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.noop = true;
  await s.e.stop("main", "manual");
  s.vms.set("vm1", "HIBERNATING");
  await s.e.tick();
  assert.equal(s.e.view().main.alarm, null);
  s.tick(11 * 60_000);
  await s.e.tick();
  assert.ok(s.e.view().main.alarm);
  assert.equal(s.log.filter((l) => l.startsWith("hibernate")).length, 2);
});

const stepOf = (s: ReturnType<typeof setup>, id: string, card: "main" | "boost" = "main") => s.e.view()[card].steps?.find((x) => x.id === id);

test("dead link blocks warm before any VM is created", async () => {
  const s = setup(undefined, undefined, undefined, undefined, { preflight: async () => ({ msg: "Krea2 checkpoint link is dead", block: true }) });
  await assert.rejects(s.e.warm(), Refused);
  assert.deepEqual(s.log, []);
  assert.equal(getVm(s.db, "main"), null);
  const v = s.e.view().main;
  assert.equal(v.phase, "off");
  assert.equal(v.steps?.[0].id, "links");
  assert.equal(v.steps?.[0].state, "fail");
});

test("a non-blocking preflight warning warms normally and shows on the links step", async () => {
  const s = setup(undefined, undefined, undefined, undefined, { preflight: async () => ({ msg: "Krea2 checkpoint link is dead", block: false }) });
  assert.equal((await s.e.warm()).phase, "starting");
  assert.equal(s.log.length, 1);
  assert.equal(stepOf(s, "links")?.state, "ok");
  assert.equal(stepOf(s, "links")?.note, "Krea2 checkpoint link is dead");
});

test("steps advance gpu, comfy, ready; models trails and the checklist clears when all ok", async () => {
  const listed: string[] = [];
  const s = setup(undefined, async () => "100.0.0.2", async () => "get a/b\nmodels ok", undefined, { listVolume: async (c) => { listed.push(c); return [{ name: "a/b", size: 1 }]; } });
  await s.e.warm();
  assert.equal(stepOf(s, "gpu")?.state, "run");
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  assert.equal(stepOf(s, "gpu")?.state, "ok");
  assert.equal(stepOf(s, "network")?.state, "ok");
  assert.equal(stepOf(s, "comfy")?.state, "run");
  s.o.pingOk = true;
  await s.e.tick();
  assert.equal(s.e.view().main.phase, "ready");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(listed, ["main"]);
  assert.equal(s.e.view().main.steps, null);
});

test("failed sync keeps the card ready and shows models fail; retry re-runs sync without recreating", async () => {
  let calls = 0;
  const s = setup(undefined, undefined, async () => { if (++calls === 1) throw new Error("FAILED loras/x.safetensors"); return "get x"; });
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.pingOk = true;
  await s.e.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.e.view().main.phase, "ready");
  assert.equal(stepOf(s, "models")?.state, "fail");
  await s.e.retry("main", "models");
  await s.e.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(s.log.filter((l) => l.startsWith("create")).length, 1);
  assert.equal(s.e.view().main.steps, null);
});

test("stop during RESTORING does not call hibernate until the VM settles", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "RESTORING");
  s.log.length = 0;
  await s.e.stop("main", "manual");
  assert.deepEqual(s.log, []);
  assert.equal(getVm(s.db, "main")?.status, "hibernating:manual"); // waiting, not failing
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  assert.deepEqual(s.log, ["hibernate vm1"]);
});

test("restart mid-start synthesizes steps from the phase", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.db.prepare("UPDATE comfy_vms SET status = 'warming' WHERE card = 'main'").run();
  const e2 = engine({ db: s.db, hs: {} as unknown as Hyperstack, ping: async () => false, now: () => T0 });
  const st = e2.view().main.steps!;
  assert.equal(st.find((x) => x.id === "gpu")?.state, "ok");
  assert.equal(st.find((x) => x.id === "network")?.state, "run");
});

test("a deferred stop raises no alarm, and the real hibernate is not retried every tick", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "RESTORING");
  await s.e.stop("main", "manual");
  for (let i = 0; i < 3; i++) { s.tick(3 * 60_000); await s.e.tick(); }
  assert.equal(s.e.view().main.alarm, null);
  assert.equal(s.e.view().main.phase, "stopping");
  assert.deepEqual(s.log.filter((l) => l.startsWith("hibernate")), []);
  s.o.noop = true; // hibernate accepted, VM goes HIBERNATING
  s.vms.set("vm1", "ACTIVE");
  s.tick(60_000);
  await s.e.tick();
  s.vms.set("vm1", "HIBERNATING");
  s.tick(60_000);
  await s.e.tick();
  s.tick(60_000);
  await s.e.tick();
  assert.equal(s.log.filter((l) => l.startsWith("hibernate")).length, 1);
  assert.equal(s.e.view().main.alarm, null);
});

test("retry models while the sync is pending does not start a second sync", async () => {
  let calls = 0;
  let done!: () => void;
  const s = setup(undefined, undefined, () => { calls++; return new Promise<string>((r) => (done = () => r("get x"))); });
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  s.o.pingOk = true;
  await s.e.tick();
  await s.e.retry("main", "models");
  await s.e.tick();
  assert.equal(calls, 1);
  done();
});

test("a stop after a settled hibernate and a fresh warm still defers while the new VM is in BUILD", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "RESTORING");
  await s.e.stop("main", "manual"); // deferred: hibSince set
  s.vms.set("vm1", "HIBERNATED");
  await s.e.tick(); // confirmed off
  s.tick(3 * H);
  await s.e.warm(); // restored, in BUILD
  s.log.length = 0;
  await s.e.stop("main", "manual");
  assert.deepEqual(s.log, []);
  assert.equal(getVm(s.db, "main")?.status, "hibernating:manual");
});

test("a VM stuck transitional keeps its alarm on and is re-hibernated every 10 min, not every tick", async () => {
  const s = setup();
  await s.e.warm();
  s.o.noop = true; // hibernate accepted, VM never settles
  s.o.detached = false; // Hyperstack can't detach mid-transition
  s.vms.set("vm1", "RESTORING");
  await s.e.stop("main", "manual");
  const seen: (string | null)[] = [];
  for (let i = 0; i < 45; i++) { s.tick(60_000); await s.e.tick(); seen.push(s.e.view().main.alarm); }
  const first = seen.findIndex((a) => a !== null);
  assert.ok(first >= 0 && first <= 11);
  assert.deepEqual(seen.slice(first).filter((a) => a === null), []); // never flaps off
  assert.ok(s.log.filter((l) => l.startsWith("hibernate")).length <= 5);
  s.vms.set("vm1", "HIBERNATED");
  await s.e.tick();
  assert.equal(s.e.view().main.alarm, "Stopped without detaching the models volume — it may show RESERVED; contact Hyperstack if the next start fails");
});

test("a non-NoCapacity restore error fails the gpu step before rethrowing", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  await s.e.stop("main", "manual");
  assert.equal(getVm(s.db, "main")?.status, "hibernated");
  s.o.restoreErr = new Error("hyperstack vm1: 400 bad request");
  await assert.rejects(s.e.warm(), /400/);
  assert.equal(stepOf(s, "gpu")?.state, "fail");
  assert.match(stepOf(s, "gpu")?.error ?? "", /400/);
});

test("ACTIVE but never on the tailnet: network fails at 15 min and the VM hibernates, failure kept", async () => {
  const s = setup(undefined, async () => null);
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  s.tick(14 * 60_000);
  await s.e.tick();
  assert.equal(stepOf(s, "network")?.state, "run");
  s.tick(2 * 60_000);
  await s.e.tick();
  assert.equal(getVm(s.db, "main")?.status, "hibernated");
  assert.equal(s.e.view().main.phase, "off");
  assert.equal(stepOf(s, "network")?.state, "fail");
  assert.equal(runs(s.db).at(-1)?.stoppedAt !== null, true);
  await s.e.retry("main", "network"); // boots again
  assert.equal(s.e.view().main.phase, "starting");
});

test("ACTIVE on the tailnet but ComfyUI never answers: comfy fails at 15 min and the VM hibernates", async () => {
  const s = setup(undefined, async () => "100.0.0.2");
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
  await s.e.tick();
  s.tick(16 * 60_000);
  await s.e.tick();
  assert.equal(getVm(s.db, "main")?.status, "hibernated");
  assert.equal(stepOf(s, "network")?.state, "ok");
  assert.equal(stepOf(s, "comfy")?.state, "fail");
});
