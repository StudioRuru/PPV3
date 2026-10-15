import { test } from "node:test";
import assert from "node:assert/strict";
import { HeavyGate, QUICK_DEFAULT, tierModel } from "./tiers";

test("tierModel: defaults, then settings override", () => {
  const none = () => null;
  assert.equal(tierModel("everyday", none, "brain"), "brain");
  assert.equal(tierModel("quick", none, "brain"), QUICK_DEFAULT);
  assert.equal(tierModel("quick", (k) => (k === "model.quick" ? "m" : null), "brain"), "m");
  assert.equal(tierModel("heavy", none, "brain"), "gemma4-26b-apex:latest");
  assert.equal(tierModel("heavy", (k) => (k === "model.heavy" ? "cydonia-24b:latest" : null), "brain"), "cydonia-24b:latest");
  assert.equal(tierModel("heavy", () => "  ", "brain"), "gemma4-26b-apex:latest");
});

const fake = (opts: { active?: boolean; slowUp?: Promise<void> } = {}) => {
  const calls: string[] = [];
  const timers: (() => void)[] = [];
  const gate = new HeavyGate({
    power: async (a) => { calls.push(a); if (a === "up" && opts.slowUp) await opts.slowUp; calls.push(`${a}:done`); return { ok: true, err: "" }; },
    active: async () => opts.active ?? true,
    unloadHeavy: async () => { calls.push("unload"); },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { if (id) timers[(id as number) - 1] = () => {}; },
  });
  return { gate, calls, fire: () => timers.splice(0).forEach((f) => f()) };
};
const tick = () => new Promise((r) => setImmediate(r));

test("two overlapping heavy runs pause once, and restore once after both finish and idle", async () => {
  const { gate, calls, fire } = fake();
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const a = gate.run(() => hold);
  const b = gate.run(async () => "b");
  assert.equal(await b, "b");
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down"]);
  fire(); // idle timer from b must have been cancelled/ignored while a still runs
  await tick();
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down"]);
  release(); await a;
  fire(); await tick();
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down", "unload", "up"]);
  assert.equal(gate.state, "light");
});

test("status is reported only by the call that paused", async () => {
  const { gate } = fake();
  const notes: string[] = [];
  await gate.run(async () => {}, (s) => notes.push(s));
  await gate.run(async () => {}, (s) => notes.push(s));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Paused captioner \+ TIPO/);
});

test("a failed heavy run restores right away", async () => {
  const { gate, calls } = fake();
  await assert.rejects(gate.run(async () => { throw new Error("out of memory"); }), /out of memory/);
  await tick();
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down", "unload", "up"]);
  assert.equal(gate.state, "light");
});

test("ensureLight while paused and idle restores once; while busy refuses", async () => {
  const { gate, calls } = fake();
  await gate.run(async () => {});
  assert.equal(await gate.ensureLight(), true);
  assert.equal(await gate.ensureLight(), true);
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down", "unload", "up"]);
  let release!: () => void;
  const p = gate.run(() => new Promise<void>((r) => (release = r)));
  await tick();
  assert.equal(await gate.ensureLight(), false);
  release(); await p;
});

test("ensureLight never powers up servers the gate didn't pause", async () => {
  const { gate, calls } = fake();
  assert.equal(await gate.ensureLight(), true);
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), []);
});

test("review I1: servers the owner had off stay off — no pause, no restore", async () => {
  const { gate, calls, fire } = fake({ active: false });
  await gate.run(async () => {});
  fire(); await tick();
  assert.equal(await gate.ensureLight(), true);
  assert.deepEqual(calls, []);
  assert.equal(gate.state, "light");
});

test("review I2: restore unloads the heavy model before restarting the captioner + TIPO", async () => {
  const { gate, calls, fire } = fake();
  await gate.run(async () => {});
  fire(); await tick();
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down", "unload", "up"]);
});

test("review M1: a heavy call during a restore waits for it instead of racing power up/down", async () => {
  let finish!: () => void;
  const slowUp = new Promise<void>((r) => (finish = r));
  const { gate, calls, fire } = fake({ slowUp });
  await gate.run(async () => {});
  fire(); await tick();                 // restore started, `up` still running
  const second = gate.run(async () => "x");
  await tick();
  assert.equal(calls.includes("down") && calls.lastIndexOf("down") > calls.indexOf("up") && !calls.includes("up:done"), false, "down must not start before up finished");
  finish();
  assert.equal(await second, "x");
  assert.deepEqual(calls.filter((c) => !c.endsWith(":done")), ["down", "unload", "up", "down"]);
});

test("busy: true while any heavy run is in flight, even when nothing was paused", async () => {
  const { gate } = fake({ active: false });
  assert.equal(gate.busy, false);
  let release!: () => void;
  const a = gate.run(() => new Promise<void>((r) => (release = r)));
  await tick();
  assert.equal(gate.state, "light");
  assert.equal(gate.busy, true);
  release(); await a;
  assert.equal(gate.busy, false);
});
