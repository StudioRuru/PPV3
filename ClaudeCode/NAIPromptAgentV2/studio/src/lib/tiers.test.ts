import { test } from "node:test";
import assert from "node:assert/strict";
import { HeavyGate, tierModel } from "./tiers";

test("tierModel: defaults, then settings override", () => {
  const none = () => null;
  assert.equal(tierModel("everyday", none, "brain"), "brain");
  assert.equal(tierModel("quick", none, "brain"), "brain");
  assert.equal(tierModel("heavy", none, "brain"), "gemma4-26b-apex:latest");
  assert.equal(tierModel("heavy", (k) => (k === "model.heavy" ? "cydonia-24b:latest" : null), "brain"), "cydonia-24b:latest");
  assert.equal(tierModel("heavy", () => "  ", "brain"), "gemma4-26b-apex:latest");
});

const fake = () => {
  const calls: string[] = [];
  const timers: (() => void)[] = [];
  const gate = new HeavyGate({
    power: async (a) => { calls.push(a); return { ok: true, err: "" }; },
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
  assert.deepEqual(calls, ["down"]);
  fire(); // idle timer from b must have been cancelled/ignored while a still runs
  await tick();
  assert.deepEqual(calls, ["down"]);
  release(); await a;
  fire(); await tick();
  assert.deepEqual(calls, ["down", "up"]);
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
  assert.deepEqual(calls, ["down", "up"]);
  assert.equal(gate.state, "light");
});

test("ensureLight while paused and idle restores once; while busy refuses", async () => {
  const { gate, calls } = fake();
  await gate.run(async () => {});
  assert.equal(await gate.ensureLight(), true);
  assert.equal(await gate.ensureLight(), true);
  assert.deepEqual(calls, ["down", "up"]);
  let release!: () => void;
  const p = gate.run(() => new Promise<void>((r) => (release = r)));
  await tick();
  assert.equal(await gate.ensureLight(), false);
  release(); await p;
});

test("ensureLight never powers up servers the gate didn't pause", async () => {
  const { gate, calls } = fake();
  assert.equal(await gate.ensureLight(), true);
  assert.deepEqual(calls, []);
});
