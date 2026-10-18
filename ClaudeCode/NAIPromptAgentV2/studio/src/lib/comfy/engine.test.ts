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

function setup(offers: Offer[] = [main, h100]) {
  const db = new Database(":memory:");
  migrate(db);
  let now = T0;
  const log: string[] = [];
  const vms = new Map<string, string>(); // id -> status
  const o = { stopFails: false, pingOk: false, offers, noop: false, listFails: false, removeFails: false, gate: null as Promise<void> | null, vol: null as { env: string } | null, vols: [] as string[] };
  let n = 0;
  const hs = {
    offers: async (min: number) => o.offers.filter((x) => x.vramGb >= min).sort((a, b) => a.usdHr - b.usdHr),
    create: async (_o: Offer, name: string) => { if (o.gate) await o.gate; const id = `vm${++n}`; vms.set(id, "BUILD"); log.push(`create ${name}`); o.vols.push(`create ${_o.env}`); return id; },
    attachWhenActive: async (id: string, vol: string) => { o.vols.push(`attach ${id} ${vol}`); },
    findVolume: async () => o.vol,
    ensureVolume: async (name: string, env: string, gb: number) => { o.vols.push(`ensure ${name} ${env} ${gb}`); },
    status: async (id: string) => vms.get(id) ?? null,
    hibernate: async (id: string) => { if (o.stopFails) throw new Error("boom"); if (!o.noop) vms.set(id, "HIBERNATED"); log.push(`hibernate ${id}`); },
    restore: async (id: string) => { vms.set(id, "BUILD"); log.push(`restore ${id}`); },
    start: async () => {},
    remove: async (id: string) => { if (o.removeFails) throw new Error("rm"); vms.delete(id); log.push(`remove ${id}`); },
    listOurs: async () => { if (o.listFails) throw new Error("ls"); return [...vms].map(([id, status]) => ({ id, status })); },
  } as unknown as Hyperstack;
  const e = engine({ db, hs, ping: async () => o.pingOk, now: () => now });
  return { db, e, vms, log, o, tick: (ms: number) => { now += ms; }, at: () => now };
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

test("warm on a hibernated VM restores instead of creating", async () => {
  const s = setup();
  await s.e.warm();
  await s.e.stop("main", "manual");
  assert.equal(s.e.view().main.phase, "off");
  const v = await s.e.warm();
  assert.equal(v.phase, "starting");
  assert.deepEqual(s.log, ["create nai-comfy-main", "hibernate vm1", "restore vm1"]);
  assert.equal(runs(s.db).length, 2);
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

test("idle tick hibernates and closes the run with reason idle", async () => {
  const s = setup();
  await s.e.warm();
  s.vms.set("vm1", "ACTIVE");
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
