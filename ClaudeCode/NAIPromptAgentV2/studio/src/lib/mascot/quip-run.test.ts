import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQuip, type QuipDeps } from "./quip-run";

const tick = () => new Promise((r) => setImmediate(r));

const deps = (over: Partial<QuipDeps> = {}) => {
  const logged: string[] = [];
  const asks: { model: string; options: Record<string, unknown> }[] = [];
  const d: QuipDeps = {
    heavyInUse: () => false,
    model: () => "quick",
    installed: async () => ["quick"],
    context: () => ({ mods: {}, drift: 0, taste: "", story: "" }),
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
