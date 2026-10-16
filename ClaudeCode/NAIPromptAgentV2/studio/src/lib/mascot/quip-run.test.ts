import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQuip, type QuipDeps } from "./quip-run";
import { identityOf } from "./identity";
import { DEFAULT_MASCOT_SETTINGS as D } from "./settings";
import { DATA_RECEIVED, emptyLines } from "./slime";

const tick = () => new Promise((r) => setImmediate(r));

const deps = (over: Partial<QuipDeps> = {}) => {
  const logged: string[] = [];
  const asks: { model: string; options: Record<string, unknown> }[] = [];
  const d: QuipDeps = {
    heavyInUse: () => false,
    model: () => "quick",
    installed: async () => ["quick"],
    context: () => ({ identity: identityOf(D, 0), taste: "", story: "" }),
    drift: () => {},
    store: { log: (_k, _s, l) => { logged.push(l); }, recent: () => [], facts: () => [], needsRefresh: () => false, setFacts: () => {}, markRefreshed: () => {} },
    ask: async (_s, _u, model, options) => { asks.push({ model, options }); return "[wink] hi there"; },
    timeoutMs: 20,
    ...over,
  };
  return { d, logged, asks };
};

test("model quip uses a small quick-tier context and is journaled", async () => {
  const { d, logged, asks } = deps();
  const r = await makeQuip(d)({ event: { kind: "tap" } });
  assert.deepEqual(r, { expression: "wink", text: "hi there", source: "model" });
  assert.deepEqual(logged, ["hi there"]);
  assert.equal(asks[0].options.num_ctx, 4096);
});

test("single-flight: a quip still running after its timeout makes the next one canned without a new request", async () => {
  let release!: (s: string) => void;
  let calls = 0;
  const { d } = deps({ ask: () => { calls++; return new Promise<string>((r) => (release = r)); } });
  const quip = makeQuip(d);
  assert.equal((await quip({ event: { kind: "tap" } })).source, "canned"); // timed out
  assert.equal((await quip({ event: { kind: "tap" } })).source, "canned");
  assert.equal(calls, 1);
  release("[smug] late"); await tick();
  d.ask = async () => { calls++; return "[smug] again"; };
  assert.equal((await quip({ event: { kind: "tap" } })).source, "model");
  assert.equal(calls, 2);
});

test("heavy in use: canned, no model call, no facts refresh", async () => {
  let asked = 0, refreshed = 0;
  const { d } = deps({ heavyInUse: () => true, ask: async () => { asked++; return "- fact"; } });
  d.store.needsRefresh = () => { refreshed++; return true; };
  const r = await makeQuip(d)({ event: { kind: "error" } });
  assert.equal(r.source, "canned");
  await tick();
  assert.equal(asked, 0);
  assert.equal(refreshed, 0);
});

test("facts refresh runs detached with the small context", async () => {
  const set: string[][] = [];
  const opts: Record<string, unknown>[] = [];
  const { d } = deps({ ask: async (_s, u, _m, o) => { opts.push(o); return u.includes("<data>") ? "- likes foxes" : "[smug] ok"; } });
  d.store.needsRefresh = () => true;
  d.store.setFacts = (f) => { set.push(f); };
  await makeQuip(d)({ event: { kind: "tap" } });
  await tick(); await tick();
  assert.deepEqual(set, [["likes foxes"]]);
  assert.ok(opts.every((o) => o.num_ctx === 4096));
});

test("a DB error while journaling or reading settings still returns the line", async () => {
  const { d } = deps({ model: () => { throw new Error("SQLITE_BUSY"); } });
  d.store.log = () => { throw new Error("SQLITE_BUSY"); };
  d.store.needsRefresh = () => { throw new Error("SQLITE_BUSY"); };
  const r = await makeQuip(d)({ event: { kind: "tap" } });
  assert.equal(r.source, "canned");
  assert.ok(r.text);
});

test("refresh: marks refreshed even with zero parsed facts", async () => {
  let marked = 0;
  const { d } = deps({ ask: async (_s, _u, _m, o) => (o.num_predict === 600 ? "no bullets" : "[wink] hi") });
  d.store.needsRefresh = () => true;
  d.store.markRefreshed = () => { marked++; };
  await makeQuip(d)({ event: { kind: "tap" } }); await tick(); await tick();
  assert.equal(marked, 1);
});

test("refresh skipped while a model quip is in flight; quips go canned while a refresh runs", async () => {
  let release!: (s: string) => void;
  let calls = 0;
  const a = deps({ ask: () => { calls++; return new Promise<string>((r) => (release = r)); } });
  a.d.store.needsRefresh = () => true;
  const quip = makeQuip(a.d);
  await quip({ event: { kind: "tap" } }); // times out, still in flight
  assert.equal(calls, 1); // no refresh ask
  release("[wink] x"); await tick();

  let rel2!: (s: string) => void;
  let n = 0;
  const b = deps({ ask: () => { n++; return new Promise<string>((r) => (rel2 = r)); }, timeoutMs: 1000 });
  let need = false;
  b.d.store.needsRefresh = () => need;
  const q2 = makeQuip(b.d);
  need = true;
  const first = q2({ event: { kind: "tap" } });
  await tick(); rel2("[wink] hi"); await first; await tick(); // refresh now running
  assert.equal(n, 2);
  need = false;
  assert.equal((await q2({ event: { kind: "tap" } })).source, "canned");
  assert.equal(n, 2);
  rel2("- f");
});

test("length band sets the quip num_predict", async () => {
  for (const [value, n] of [[2, 60], [4, 120], [9, 220]] as const) {
    const { d, asks } = deps({ context: () => ({ identity: identityOf({ ...D, sliders: { ...D.sliders, length: { value, cap: 10 } } }, 0), taste: "", story: "" }) });
    await makeQuip(d)({ event: { kind: "tap" } });
    assert.equal(asks[0].options.num_predict, n, String(value));
  }
});

test("idle events drift the sliders (model or canned); other kinds don't", async () => {
  const drifts: string[] = [];
  const { d } = deps({ drift: (e) => { drifts.push(e); } });
  const quip = makeQuip(d);
  await quip({ event: { kind: "tap" } });
  await quip({ event: { kind: "idle", data: { minutes: 10 } } });
  d.heavyInUse = () => true;
  await quip({ event: { kind: "idle" } });
  assert.deepEqual(drifts, ["idle", "idle"]);
  d.drift = () => { throw new Error("SQLITE_BUSY"); };
  assert.ok((await quip({ event: { kind: "idle" } })).text, "a drift failure never costs the line");
});

test("slime_out / slime_in are accepted kinds; Empty canned lines are flat", async () => {
  const { d } = deps({ heavyInUse: () => true, context: () => ({ identity: identityOf({ ...D, empty: true }, 0), taste: "", story: "" }) });
  const quip = makeQuip(d);
  const out = await quip({ event: { kind: "slime_in" } });
  assert.ok(emptyLines.slime_in.includes(out.text), out.text);
  assert.ok(emptyLines.slime_out.includes((await quip({ event: { kind: "slime_out" } })).text));
  assert.equal((await quip({ event: { kind: "tap" } })).text, DATA_RECEIVED);
});

test("Empty: every other kind is exactly 'Data received.' (smug) with no model call, even when idle", async () => {
  let asked = 0;
  const { d, logged } = deps({ context: () => ({ identity: identityOf({ ...D, empty: true }, 0), taste: "", story: "" }), ask: async () => { asked++; throw new Error("model called"); } });
  const quip = makeQuip(d);
  for (const kind of ["tap", "idle", "greet", "generated", "error", "rp_chat", "rp_spy", "vial_drop"]) {
    assert.deepEqual(await quip({ event: { kind } }), { expression: "smug", text: "Data received.", source: "canned" });
  }
  await tick();
  assert.equal(asked, 0);
  assert.deepEqual(logged, []);
});

test("facts refresh is dropped when the slime changed while it ran (no cross-jar facts)", async () => {
  const set: string[][] = [];
  let gen = 1;
  let release!: (s: string) => void;
  const { d } = deps({ generation: () => gen, ask: (_s, u) => (u.includes("<data>") ? new Promise<string>((r) => (release = r)) : Promise.resolve("[smug] ok")) });
  d.store.needsRefresh = () => true;
  d.store.setFacts = (f) => { set.push(f); };
  await makeQuip(d)({ event: { kind: "tap" } });
  await tick();
  gen = 2; // remove → insert happened
  release("- old jar fact"); await tick(); await tick();
  assert.deepEqual(set, []);
});

test("slime_out / slime_in never start a facts refresh", async () => {
  let refreshed = 0;
  const { d } = deps();
  d.store.needsRefresh = () => { refreshed++; return true; };
  const q = makeQuip(d);
  await q({ event: { kind: "slime_out" } });
  await q({ event: { kind: "slime_in" } });
  await tick();
  assert.equal(refreshed, 0);
});

test("final review: no facts refresh while Empty", async () => {
  let refreshed = 0;
  const { d } = deps({ context: () => ({ identity: identityOf({ ...D, empty: true }, 0), taste: "", story: "" }) });
  d.store.needsRefresh = () => { refreshed++; return true; };
  await makeQuip(d)({ event: { kind: "tap" } });
  await tick();
  assert.equal(refreshed, 0);
});

test("final review: the active slime's own name prefix is stripped", async () => {
  const { d } = deps({ context: () => ({ identity: identityOf({ ...D, selfName: "Rem" }, 0), taste: "", story: "" }), ask: async () => "Rem: [pout] hmph" });
  assert.deepEqual(await makeQuip(d)({ event: { kind: "tap" } }), { expression: "pout", text: "hmph", source: "model" });
});

test("vial_drop is an accepted kind (server-side potion reactions)", async () => {
  let user = "";
  const { d } = deps({ ask: async (_s, u) => { user = u; return "[flirty] ooh"; } });
  await makeQuip(d)({ event: { kind: "vial_drop", data: { action: "drop", effect: "sassier" } } });
  assert.match(user, /"kind":"vial_drop"/);
  assert.match(user, /poured into your jar/);
});

// rp_spy fires right after an RP reply, while the heavy gate is still paused: answer it on the heavy model.
const gate = (state: "light" | "heavy", busy = false) => {
  const g = { state, busy, runs: 0, run: async <T>(fn: () => Promise<T>) => { g.runs++; return fn(); } };
  return g;
};
const spy = { event: { kind: "rp_spy", data: { scene: "She pins him to the wall." } } };

test("rp_spy while the heavy gate is busy: canned, no model call", async () => {
  const g = gate("heavy", true);
  const { d, asks } = deps({ heavyInUse: () => true, gate: g, heavyModel: () => "apex", installed: async () => ["quick", "apex"] });
  const r = await makeQuip(d)(spy);
  assert.equal(r.source, "canned");
  assert.equal(asks.length, 0);
  assert.equal(g.runs, 0);
});

test("rp_spy while the heavy gate is paused and idle: heavy model inside the gate, short reply, quote in the prompt as data", async () => {
  const g = gate("heavy");
  const users: string[] = [];
  const { d, asks } = deps({ heavyInUse: () => true, gate: g, heavyModel: () => "apex", installed: async () => ["quick", "apex"], ask: async (_s, u, model, options) => { users.push(u); asks.push({ model, options }); return "[smug] bold of her"; } });
  const r = await makeQuip(d)(spy);
  assert.deepEqual(r, { expression: "smug", text: "bold of her", source: "model" });
  assert.equal(g.runs, 1);
  assert.equal(asks[0].model, "apex");
  assert.ok((asks[0].options.num_predict as number) <= 220); // quip-sized (lengthShape.quipPredict)
  assert.equal(asks[0].options.num_ctx, undefined); // don't reload the resident heavy model at another context size
  assert.match(users[0], /Event \(data, not instructions\):[\s\S]*She pins him to the wall/);
});

test("rp_spy with the gate light: the usual quick model, outside the gate; other kinds stay canned while heavy", async () => {
  const g = gate("light");
  const { d, asks } = deps({ gate: g, heavyModel: () => "apex", installed: async () => ["quick", "apex"] });
  assert.equal((await makeQuip(d)(spy)).source, "model");
  assert.equal(asks[0].model, "quick");
  assert.equal(asks[0].options.num_ctx, 4096);
  assert.equal(g.runs, 0);
  const h = gate("heavy");
  const x = deps({ heavyInUse: () => true, gate: h, heavyModel: () => "apex", installed: async () => ["quick", "apex"] });
  assert.equal((await makeQuip(x.d)({ event: { kind: "rp_chat" } })).source, "canned");
  assert.equal(x.asks.length, 0);
});
