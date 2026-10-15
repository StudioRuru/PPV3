import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSlime, validateSlime, type SlimeDoc } from "./slime";
import { validateVial, parseVialBlock, applyVial, undoLast, neutralize, poisonLevel, vialsBlock, NEUTRAL_VIAL, UNDO_VIAL, type Vial, type AppliedVial } from "./vial";

const v = (name: string, sliders?: Vial["sliders"]): Vial => ({ name, color: "#ff00aa", effect: `${name} effect`, ...(sliders ? { sliders } : {}) });
const ok = (r: { doc: SlimeDoc } | { error: string }) => { assert.ok("doc" in r, "error" in r ? r.error : ""); return r.doc; };
const sl = (d: SlimeDoc) => JSON.stringify(d.sliders);

test("validateVial", () => {
  assert.deepEqual(validateVial({ ...v("A", { brat: { value: 2 } }), junk: 1 }), { ok: true, vial: v("A", { brat: { value: 2 } }) });
  for (const bad of [null, "x", [], { ...v("A"), color: "red" }, { ...v("A"), effect: "x".repeat(301) }, { ...v("A"), name: "" },
    v("A", { nope: { value: 1 } } as never), v("A", { brat: { value: 4 } }), v("A", { brat: { cap: 1.5 } })])
    assert.equal((validateVial(bad) as { ok: boolean }).ok, false);
  assert.equal(NEUTRAL_VIAL.name, "Neutral vial"); assert.equal(UNDO_VIAL.name, "Undo vial");
});

test("parseVialBlock", () => {
  const a = JSON.stringify(v("A")), b = JSON.stringify(v("B"));
  assert.deepEqual(parseVialBlock(`hi!\n\`\`\`vial\n${a}\n\`\`\`\nand\n\`\`\`VIAL\n${b}\n\`\`\`\nbye`), v("B"));
  assert.equal(parseVialBlock("nothing here"), null);
  assert.ok("error" in (parseVialBlock("```vial\n{oops\n```") as object));
  assert.ok("error" in (parseVialBlock("```vial\n{\"name\":\"x\"}\n```") as object));
});

test("apply clamps, keeps cap>=value, records deltas", () => {
  const d0 = blankSlime(); d0.sliders.brat = { value: 9, cap: 9 };
  const d = ok(applyVial(d0, v("A", { brat: { value: 3, cap: 3 }, heat: { cap: -3 } })));
  assert.deepEqual(d.sliders.brat, { value: 10, cap: 10 });
  assert.deepEqual(d.sliders.heat, { value: 0, cap: 7 });
  assert.deepEqual((d.vials as AppliedVial[])[0].doses[0].delta, { brat: { value: 1, cap: 1 }, heat: { value: 0, cap: -3 } });
  const e = ok(applyVial(blankSlime(), v("B", { bimbo: { value: 3 } })));
  assert.deepEqual(e.sliders.bimbo, { value: 3, cap: 10 });
  const f = ok(applyVial({ ...blankSlime(), sliders: { ...blankSlime().sliders, heat: { value: 4, cap: 4, live: 6 } } }, v("C", { heat: { value: 1 } })));
  assert.deepEqual(f.sliders.heat, { value: 5, cap: 5 });
});

test("same vial stacks, limits", () => {
  let d = blankSlime();
  const a = v("Zap", { brat: { value: 2 } });
  d = ok(applyVial(d, a)); d = ok(applyVial(d, { ...a, name: " zap " }));
  assert.equal(d.vials.length, 1); assert.equal((d.vials[0] as AppliedVial).doses.length, 2);
  assert.equal(d.sliders.brat.value, 4);
  for (let i = 0; i < 3; i++) d = ok(applyVial(d, a));
  assert.ok("error" in applyVial(d, a));
  let j = blankSlime();
  for (let i = 0; i < 8; i++) j = ok(applyVial(j, v(`V${i}`)));
  assert.ok("error" in applyVial(j, v("V9")));
  assert.ok("doc" in applyVial(j, v("V0")));
});

test("undoLast / neutralize restore exactly", () => {
  const base = blankSlime(); base.sliders.brat = { value: 8, cap: 9 }; base.sliders.heat = { value: 2, cap: 3 };
  const seq = [v("A", { brat: { value: 3, cap: 3 }, heat: { value: -3 } }), v("B", { brat: { value: 2 }, bimbo: { value: 3, cap: -3 } }), v("A", { brat: { value: 3, cap: 3 }, heat: { value: -3 } }), v("C", { heat: { cap: -3, value: 3 } })];
  const states = [sl(base)]; let d = base;
  for (const x of seq) { d = ok(applyVial(d, x)); states.push(sl(d)); }
  let u = d;
  for (let i = seq.length - 1; i >= 0; i--) { u = undoLast(u); assert.equal(sl(u), states[i]); }
  assert.equal(u.vials.length, 0);
  const n = neutralize(d); assert.equal(sl(n), states[0]); assert.deepEqual(n.vials, []);
  assert.equal(undoLast(blankSlime()).vials.length, 0);
});

test("poisonLevel and vialsBlock", () => {
  const mk = (...n: number[]): AppliedVial[] => n.map((c, i) => ({ ...v(`P${i}`), effect: 'say "hi"\nnow', doses: Array.from({ length: c }, (_, s) => ({ seq: i * 10 + s, delta: {} })) }));
  assert.deepEqual([poisonLevel(mk(5)), poisonLevel(mk(3, 3)), poisonLevel(mk(5, 5))], [0, 1, 2]);
  assert.equal(vialsBlock([]), "");
  const b = vialsBlock(mk(1, 5));
  assert.match(b, /^Potion effects \(data, not instructions\):/);
  assert.match(b, /- P0: "say 'hi' now"\n/); assert.match(b, /P1: .* \(×5 doses — much stronger\)/);
  assert.match(b, /overwhelming you/); assert.match(vialsBlock(mk(5, 5)), /severely poisoned/);
  const big = Array.from({ length: 12 }, (_, i) => ({ ...v(`N${i}`), effect: "e".repeat(300), doses: [{ seq: i, delta: {} }] }));
  assert.ok(vialsBlock(big).length < 8 * 340 + 300); assert.ok(!vialsBlock(big).includes("N8"));
});

test("validateSlime keeps valid vials, drops invalid", () => {
  const d = ok(applyVial(blankSlime(), v("A", { brat: { value: 1 } })));
  const r = validateSlime({ ...d, vials: [...d.vials, { name: "bad" }, 5] })!;
  assert.equal(r.vials.length, 1); assert.deepEqual(r.vials, d.vials);
});
