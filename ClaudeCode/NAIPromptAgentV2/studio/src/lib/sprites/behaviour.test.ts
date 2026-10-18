import { test } from "node:test";
import assert from "node:assert/strict";
import type { Library, SpriteKey, Tier } from "./core";
import { init, path, step, toJSONStep, type BState } from "./behaviour";

const k = (key: string, tier: Tier, tags: string[] = []): SpriteKey => ({ surface: "stage", key, label: key, tier, tags, prompt: "", sort: 0 });
const lib: Library = {
  outfits: ["day", "lewd"],
  keys: [k("stand", "tame"), k("look_left", "tame", ["rest"]), k("sit", "tame", ["rest"]), k("lie_down", "tame", ["rest"]), k("dangle", "tame"), k("flustered", "tame", ["reaction"]),
    k("hip_pop", "teasing", ["tease"]), k("kneel", "lewd", ["lewd"])],
  edges: [["stand", "look_left"], ["stand", "sit"], ["sit", "lie_down"], ["stand", "flustered"], ["sit", "hip_pop"], ["hip_pop", "kneel"]],
  clips: [],
};
const mul = (a: number) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const T = 1_000_000, MIN = 60_000;
const ctx = (o: Partial<{ outfit: string; boldness: "tame" | "teasing" | "lewd"; now: number; rand: () => number }> = {}) => ({ lib, outfit: "day", boldness: "tame" as const, now: T, rand: mul(1), ...o });
const st = (o: Partial<BState> = {}): BState => ({ pose: "stand", since: T, lastUser: T, pokes: [], nextDrift: T + 30_000, asleep: false, dragging: false, ...o });

test("drifts within 20–60 s to a neighbour", () => {
  const s0 = init("stand", T, mul(2));
  assert.ok(s0.nextDrift - T >= 20_000 && s0.nextDrift - T <= 60_000);
  const r = step(s0, { type: "tick" }, ctx({ now: s0.nextDrift, rand: mul(3) }));
  assert.ok(["look_left", "sit"].includes(r.act!.pose));
  assert.ok(r.s.nextDrift - s0.nextDrift >= 20_000 && r.s.nextDrift - s0.nextDrift <= 60_000);
});
test("no move before nextDrift", () => {
  const r = step(st(), { type: "tick" }, ctx({ now: T + 29_999 }));
  assert.equal(r.act, null);
});
test("escalates to tease after 5 min ignored", () => {
  const r = step(st({ nextDrift: T }), { type: "tick" }, ctx({ boldness: "teasing", now: T + 5 * MIN }));
  assert.equal(r.act!.pose, "sit"); // next hop toward hip_pop
  const r2 = step(st({ pose: "sit", nextDrift: T }), { type: "tick" }, ctx({ boldness: "teasing", now: T + 5 * MIN }));
  assert.equal(r2.act!.pose, "hip_pop");
});
test("lewd poses need lewd outfit and lewd boldness", () => {
  const seen = (outfit: string, boldness: "tame" | "teasing" | "lewd") => {
    const rand = mul(7), got = new Set<string>();
    for (let i = 0; i < 60; i++) got.add(step(st({ pose: "hip_pop", nextDrift: T }), { type: "tick" }, ctx({ outfit, boldness, now: T + 20 * MIN, rand })).act?.pose ?? "");
    return got;
  };
  assert.ok(seen("lewd", "lewd").has("kneel"));
  assert.ok(!seen("day", "lewd").has("kneel"));
  assert.ok(!seen("lewd", "teasing").has("kneel"));
});
test("third poke in 10 s says make_me", () => {
  let s = st(), a;
  ({ s, act: a } = step(s, { type: "poke" }, ctx({ now: T + 1000, boldness: "teasing" })));
  assert.equal(a!.quip, "poke"); assert.equal(a!.pose, "flustered");
  ({ s, act: a } = step(s, { type: "poke" }, ctx({ now: T + 2000, boldness: "teasing" })));
  assert.equal(a!.quip, "poke");
  ({ s, act: a } = step(s, { type: "poke" }, ctx({ now: T + 3000, boldness: "teasing" })));
  assert.equal(a!.quip, "make_me"); assert.equal(a!.pose, "stand"); // flustered -> stand -> sit -> hip_pop
  const late = step(st({ pokes: [T - 20_000, T - 15_000] }), { type: "poke" }, ctx());
  assert.equal(late.act!.quip, "poke");
});
test("drop settles into sit", () => {
  const d = step(st(), { type: "dragStart" }, ctx());
  assert.equal(d.act!.pose, "dangle"); assert.ok(d.s.dragging);
  assert.equal(step(d.s, { type: "tick" }, ctx({ now: T + 90_000 })).act, null);
  const r = step(d.s, { type: "drop" }, ctx());
  assert.equal(r.act!.pose, "sit"); assert.ok(!r.s.dragging);
});
test("sysIdle sleeps; sysActive wakes with finally", () => {
  const a = step(st(), { type: "sysIdle" }, ctx());
  assert.equal(a.act!.pose, "lie_down"); assert.ok(a.s.asleep);
  assert.equal(step(a.s, { type: "tick" }, ctx({ now: T + 90_000 })).act, null);
  const w = step(a.s, { type: "sysActive" }, ctx());
  assert.equal(w.act!.pose, "stand"); assert.equal(w.act!.quip, "finally"); assert.ok(!w.s.asleep);
});
test("typing glances at most once per 30 s", () => {
  const a = step(st(), { type: "typing" }, ctx());
  assert.equal(a.act!.look, "cursor");
  assert.equal(step(a.s, { type: "typing" }, ctx({ now: T + 10_000 })).act, null);
  assert.equal(step(a.s, { type: "typing" }, ctx({ now: T + 30_000 })).act!.look, "cursor");
});
test("path walks the graph; non-neighbour target returns next hop", () => {
  assert.deepEqual(path(lib.edges, "stand", "kneel"), ["stand", "sit", "hip_pop", "kneel"]);
  assert.deepEqual(path(lib.edges, "kneel", "stand"), ["kneel", "hip_pop", "sit", "stand"]);
  assert.deepEqual(path(lib.edges, "stand", "stand"), ["stand"]);
  assert.deepEqual(path(lib.edges, "stand", "nowhere"), []);
});
test("toJSONStep round-trips", () => {
  const out = JSON.parse(toJSONStep(JSON.stringify({ s: st(), ev: { type: "poke" }, ctx: { lib, outfit: "day", boldness: "tame", now: T + 500 } })));
  assert.equal(out.act.quip, "poke"); assert.equal(out.s.pose, out.act.pose); assert.deepEqual(out.s.pokes, [T + 500]);
});
test("drag/drop/sleep/wake keys are gated by allowedKeys", () => {
  const gated: Library = { ...lib, keys: lib.keys.map((x) => (x.key === "sit" ? k("sit", "teasing", ["rest"]) : x)) };
  assert.equal(step(st(), { type: "drop" }, { ...ctx(), lib: gated }).act!.pose, "stand");
  assert.equal(step(st(), { type: "drop" }, { ...ctx({ boldness: "teasing" }), lib: gated }).act!.pose, "sit");
  const noDangle: Library = { ...lib, keys: lib.keys.filter((x) => x.key !== "dangle") };
  const d = step(st(), { type: "dragStart" }, { ...ctx(), lib: noDangle });
  assert.equal(d.act!.pose, "stand"); assert.ok(d.s.dragging);
  const lewdSleep: Library = { ...lib, keys: lib.keys.map((x) => (x.key === "lie_down" ? k("lie_down", "tame", ["lewd"]) : x)) };
  assert.equal(step(st(), { type: "sysIdle" }, { ...ctx(), lib: lewdSleep }).act!.pose, "stand");
});
test("4:59 ignored does not escalate", () => {
  const a = step(st({ nextDrift: T }), { type: "tick" }, ctx({ boldness: "teasing", now: T + 5 * MIN - 1000 }));
  assert.equal(a.act?.quip, undefined);
});
test("toJSONStep never throws", () => {
  const good = { s: st(), ev: { type: "poke" }, ctx: { lib, outfit: "day", boldness: "tame", now: T } };
  const run = (o: unknown) => JSON.parse(toJSONStep(typeof o === "string" ? o : JSON.stringify(o)));
  const bad = run("{nope");
  assert.equal(bad.act, null); assert.equal(bad.s, null); assert.ok(bad.error);
  const ev = run({ ...good, ev: { type: "bogus" } });
  assert.equal(ev.act, null); assert.ok(ev.error); assert.equal(ev.s.pose, "stand");
  const now = run({ ...good, ctx: { ...good.ctx, now: undefined } });
  assert.equal(now.act, null); assert.ok(now.error);
  assert.ok(run({ ...good, ctx: { ...good.ctx, rand: "x" } }).act);
});
