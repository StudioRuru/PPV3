import test from "node:test";
import assert from "node:assert/strict";
import { SLIDERS, validateSlime, sliderBlock, lengthShape, driftSlider, resetLive, setSlider, mixSliders, mixMemories, EMPTY_BLOCK, emptyLines, blankSlime, type Sliders } from "./slime";
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
