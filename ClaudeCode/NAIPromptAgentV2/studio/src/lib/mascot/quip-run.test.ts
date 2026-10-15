import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQuip, type QuipDeps } from "./quip-run";
import { identityOf } from "./identity";
import { DEFAULT_MASCOT_SETTINGS as D } from "./settings";
import { emptyLines } from "./slime";

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
  assert.ok(["...", "Okay.", "Understood."].includes((await quip({ event: { kind: "tap" } })).text));
});
