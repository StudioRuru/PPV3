import test from "node:test";
import assert from "node:assert/strict";
import { SLIDERS, validateSlime, sliderBlock, lengthShape, driftSlider, resetLive, setSlider, mixSliders, mixMemories, EMPTY_BLOCK, emptyLines, blankSlime, sliderCaption, dragSlider, driftNote, type Sliders } from "./slime";
import { HYPNOSIS_TIERS, BIMBO_TIERS } from "../rp/mods";

const sl = (o: Partial<Record<(typeof SLIDERS)[number], [number, number]>> = {}): Sliders =>
  Object.fromEntries(SLIDERS.map((k) => [k, { value: o[k]?.[0] ?? 0, cap: o[k]?.[1] ?? 10 }])) as Sliders;
const only = (id: (typeof SLIDERS)[number], v: number) => sliderBlock(sl({ [id]: [v, 10] }));

test("blank slime validates and round-trips", () => {
  const b = blankSlime();
  assert.deepEqual(validateSlime(JSON.parse(JSON.stringify(b))), b);
  assert.equal(b.voice, "");
  for (const k of SLIDERS) assert.deepEqual(b.sliders[k], { value: 0, cap: 10 });
});

test("validate rejects/caps", () => {
  const b = JSON.parse(JSON.stringify(blankSlime()));
  assert.equal(validateSlime(null), null);
  assert.equal(validateSlime({ ...b, name: "" }), null);
  assert.equal(validateSlime({ ...b, color: "red" }), null);
  assert.equal(validateSlime({ ...b, sliders: { ...b.sliders, brat: { value: 11, cap: 10 } } }), null);
  assert.equal(validateSlime({ ...b, sliders: { ...b.sliders, brat: { value: 5.5, cap: 10 } } }), null);
  assert.equal(validateSlime({ ...b, sliders: { ...b.sliders, brat: { value: 6, cap: 5 } } }), null);
  const ok = validateSlime({ ...b, name: "x".repeat(99), voice: "v".repeat(5000), junk: 1, vials: new Array(20).fill({}),
    memories: { facts: new Array(500).fill("f"), journal: new Array(80).fill({ kind: "k", summary: "s", line: "l", created_at: 1 }) } })!;
  assert.equal(ok.name.length, 40);
  assert.equal(ok.voice.length, 1500);
  assert.equal(ok.vials.length, 8);
  assert.equal(ok.memories.journal.length, 50);
  assert.ok(ok.memories.facts.length <= 100);
  assert.equal("junk" in ok, false);
});

test("slider tiers: empty at 0, distinct at 1/5/10", () => {
  for (const id of SLIDERS) {
    assert.equal(only(id, 0), "");
    if (id === "length") continue;
    const t = [1, 5, 10].map((v) => only(id, v));
    assert.ok(t.every(Boolean), id);
    assert.equal(new Set(t).size, 3, id);
  }
  assert.equal(sliderBlock(sl()), "");
});

test("bimbo/hypnosis reuse rp/mods prose; live overrides value", () => {
  const h = only("hypnosis", 10), b = only("bimbo", 10);
  assert.ok(h.includes(HYPNOSIS_TIERS[4].body.split("{{char}}")[1].split("{L}")[0].trim().slice(0, 30)));
  assert.ok(b.includes(BIMBO_TIERS[4].body.split("{{char}}")[1].split("{P}")[0].trim()));
  assert.equal(sliderBlock({ ...sl(), brat: { value: 0, cap: 10, live: 5 } }), only("brat", 5));
  assert.ok(!h.includes("{{") && !h.includes("{L}") && !b.includes("{P}"));
});

test("lengthShape bands", () => {
  assert.deepEqual(lengthShape(0), { sentences: "one short burst", quipPredict: 60, talkPredict: 250 });
  assert.equal(lengthShape(3).quipPredict, 60);
  assert.deepEqual(lengthShape(4), { sentences: "1–2 sentences", quipPredict: 120, talkPredict: 500 });
  assert.equal(lengthShape(6).talkPredict, 500);
  assert.deepEqual(lengthShape(7), { sentences: "a 3–5 sentence tantrum", quipPredict: 220, talkPredict: 900 });
  assert.equal(lengthShape(10).quipPredict, 220);
});

test("drift: brat to cap, heat only with toggle, reset/set clear live", () => {
  let s = sl({ brat: [3, 4], heat: [2, 10] });
  s = driftSlider(s, "idle", false);
  assert.equal(s.brat.live, 4);
  assert.equal(s.heat.live, undefined);
  s = driftSlider(s, "dislike", false);
  assert.equal(s.brat.live, 4);
  assert.equal(driftSlider(s, "idle", true).heat.live, 3);
  assert.equal(s.bimbo.live, undefined);
  const r = resetLive(driftSlider(s, "idle", true));
  assert.ok(SLIDERS.every((k) => r[k].live === undefined));
  const t = setSlider(driftSlider(s, "idle", true), "brat", { value: 7 });
  assert.deepEqual(t.brat, { value: 7, cap: 7 });
  assert.equal(setSlider(s, "brat", { cap: 1 }).brat.value, 1);
  assert.deepEqual(setSlider(s, "brat", { value: 99 }).brat, { value: 10, cap: 10 });
});

test("mixSliders ratio, rounding, cap>=value", () => {
  const a = sl({ brat: [10, 10], bimbo: [3, 4] }), b = sl({ brat: [0, 10], bimbo: [0, 10], heat: [5, 5] });
  assert.equal(mixSliders(a, b, 50).brat.value, 5);
  assert.equal(mixSliders(a, b, 90).brat.value, 9);
  assert.equal(mixSliders(a, b, 10).brat.value, 1);
  const m = mixSliders(a, b, 50); // 1.5 -> 2 ; cap 7
  assert.equal(m.bimbo.value, 2);
  assert.equal(m.bimbo.cap, 7);
  for (const r of [10, 33, 50, 77, 90]) { const x = mixSliders(a, b, r); for (const k of SLIDERS) { assert.ok(Number.isInteger(x[k].value) && Number.isInteger(x[k].cap)); assert.ok(x[k].cap >= x[k].value); } }
});

test("mixMemories dominant first, dedupe, caps", () => {
  const j = (n: number) => ({ kind: "k", summary: `s${n}`, line: "l", created_at: n });
  const d = { facts: ["a", "b"], journal: [j(1)] }, o = { facts: ["b", "c"], journal: [j(2)] };
  assert.deepEqual(mixMemories(d, o).facts, ["a", "b", "c"]);
  assert.equal(mixMemories(d, o).journal[0].summary, "s1");
  const big = { facts: Array.from({ length: 200 }, (_, i) => `f${i}`), journal: Array.from({ length: 60 }, (_, i) => j(i)) };
  const m = mixMemories(big, big);
  assert.ok(m.facts.length <= 100);
  assert.equal(m.journal.length, 50);
});

test("empty persona", () => {
  assert.match(EMPTY_BLOCK, /flat/i);
  assert.ok(emptyLines.slime_out.length && emptyLines.slime_in.length);
});

test("fix round 1: facts cap 12x160", () => {
  const b = JSON.parse(JSON.stringify(blankSlime()));
  const v = validateSlime({ ...b, memories: { facts: Array.from({ length: 20 }, () => "x".repeat(400)), journal: [] } })!;
  assert.equal(v.memories.facts.length, 12);
  assert.ok(v.memories.facts.every((f) => f.length <= 160));
  const m = mixMemories({ facts: Array.from({ length: 20 }, (_, i) => "d" + i + "y".repeat(300)), journal: [] }, { facts: ["o"], journal: [] });
  assert.equal(m.facts.length, 12);
  assert.ok(m.facts.every((f) => f.length <= 160));
});

test("fix round 1: bimbo/hypnosis tiers match rp/mods mapping", () => {
  const body = (t: { body: string }) => t.body.split("{{char}}")[1].split(/\{[LP]\}/)[0].trim();
  for (const [lvl, i] of [[2, 1], [4, 2], [10, 4], [1, 0], [8, 4]] as const) {
    assert.ok(only("bimbo", lvl).includes(body(BIMBO_TIERS[i])), `bimbo ${lvl}`);
  }
  for (const [lvl, i] of [[2, 0], [4, 1], [10, 4]] as const) {
    assert.ok(only("hypnosis", lvl).includes(body(HYPNOSIS_TIERS[i])), `hypnosis ${lvl}`);
  }
});

test("fix round 1: extra validation and clamps", () => {
  const b = JSON.parse(JSON.stringify(blankSlime()));
  for (const d of ["../x", "a/../b", "/abs", "a\\b"]) assert.equal(validateSlime({ ...b, look: { ...b.look, spriteDir: d } }), null, d);
  assert.ok(validateSlime({ ...b, look: { ...b.look, spriteDir: "slimes/abc" } }));
  for (const c of ["#fff", "red"]) assert.equal(validateSlime({ ...b, color: c }), null);
  const live = validateSlime({ ...b, sliders: { ...b.sliders, brat: { value: 2, cap: 4, live: 9 } } })!;
  assert.equal(live.sliders.brat.live, undefined);
  assert.equal(validateSlime({ ...b, selfName: "s".repeat(90) })!.selfName.length, 40);
  const d = driftSlider(sl({ heat: [1, 5] }), "idle", true);
  assert.equal(setSlider(d, "heat", { value: 2 }).heat.live, undefined);
  const a = sl({ brat: [10, 10] }), z = sl();
  assert.deepEqual(mixSliders(a, z, 0), mixSliders(a, z, 10));
  assert.deepEqual(mixSliders(a, z, 100), mixSliders(a, z, 90));
});

test("memories are newest-first: validateSlime caps keep the first (newest) items", () => {
  const b = blankSlime();
  const facts = Array.from({ length: 20 }, (_, i) => `f${19 - i}`); // f19 newest … f0 oldest
  const journal = Array.from({ length: 70 }, (_, i) => ({ kind: "tap", summary: "", line: "", created_at: 69 - i }));
  const v = validateSlime({ ...b, memories: { facts, journal } })!;
  assert.deepEqual(v.memories.facts, facts.slice(0, 12));
  assert.equal(v.memories.journal[0].created_at, 69);
  assert.equal(v.memories.journal.at(-1)!.created_at, 20);
});

test("sliderCaption: off at 0, tier label per level, length shows reply shape", () => {
  assert.equal(sliderCaption("brat", 0), "off");
  assert.equal(sliderCaption("brat", 1), "mildly cheeky");
  assert.equal(sliderCaption("brat", 6), "smug show-off");
  assert.equal(sliderCaption("brat", 10), "mocking tyrant");
  assert.equal(sliderCaption("heat", 10), "overwhelmed");
  assert.equal(sliderCaption("bimbo", 1), BIMBO_TIERS[0].label);
  assert.equal(sliderCaption("bimbo", 10), BIMBO_TIERS[4].label);
  assert.equal(sliderCaption("hypnosis", 10), HYPNOSIS_TIERS[4].label);
  assert.equal(sliderCaption("length", 0), "off");
  assert.equal(sliderCaption("length", 5), lengthShape(5).sentences);
});
test("dragSlider: value clamps to cap; lowering cap lowers value; live dropped", () => {
  assert.deepEqual(dragSlider({ value: 3, cap: 5, live: 5 }, "value", 8), { value: 5, cap: 5 });
  assert.deepEqual(dragSlider({ value: 3, cap: 5 }, "value", 1), { value: 1, cap: 5 });
  assert.deepEqual(dragSlider({ value: 6, cap: 8 }, "cap", 4), { value: 4, cap: 4 });
  assert.deepEqual(dragSlider({ value: 2, cap: 8 }, "cap", 10), { value: 2, cap: 10 });
  assert.deepEqual(dragSlider({ value: 2, cap: 8 }, "cap", 12), { value: 2, cap: 10 });
});
test("driftNote: only when live is above value", () => {
  assert.equal(driftNote({ value: 4, cap: 8, live: 7 }), "drifted to 7");
  assert.equal(driftNote({ value: 4, cap: 8, live: 4 }), null);
  assert.equal(driftNote({ value: 4, cap: 8 }), null);
});
