import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPhoto } from "./photo-draft";
import { matchRule, rulePatch, safePatch, suggest } from "./tuning";

const r = { ...defaultPhoto(["sdxl.safetensors"]), cfg: 5, steps: 30, loras: [{ name: "a", strength: 0.9 }, { name: "b", strength: 0.8 }] };
test("face boosts first lora, eases others", () => assert.deepEqual(rulePatch("face", r).patch.loras, [{ name: "a", strength: 1.05 }, { name: "b", strength: 0.65 }]));
test("face without loras turns on faceFix", () => assert.deepEqual(rulePatch("face", { ...r, loras: [] }).patch, { faceFix: true }));
test("strong scales strengths", () => assert.deepEqual(rulePatch("strong", r).patch.loras, [{ name: "a", strength: 0.7 }, { name: "b", strength: 0.6 }]));
test("hands caps steps at 60", () => assert.equal(rulePatch("hands", { ...r, steps: 55 }).patch.steps, 60));
test("blurry adds hires once", () => { assert.deepEqual(rulePatch("blurry", r).patch.hires, { scale: 1.5, denoise: 0.35 }); assert.equal(rulePatch("blurry", { ...r, hires: { scale: 2, denoise: 0.3 } }).patch.hires, undefined); });
test("matchRule reads typed text", () => { assert.equal(matchRule("her face looks different"), "face"); assert.equal(matchRule("fingers are melted"), "hands"); assert.equal(matchRule("make it purple"), null); });
test("safePatch drops unknown loras and model", () => assert.deepEqual(safePatch(r, { model: "x", loras: [{ name: "a", strength: 0.5 }, { name: "gone", strength: 1 }], steps: 40 }), { loras: [{ name: "a", strength: 0.5 }, { name: "b", strength: 0.8 }], steps: 40 }));
test("offline model falls back to canned line", async () => {
  const s = await suggest({ chip: "strong", recipe: r }, { complete: async () => { throw new Error("down"); } });
  assert.match(s.say, /^Hmph, my brain's napping~/);
  assert.ok(s.patch.loras);
});

test("rulePatch on an edited recipe is based on the new strengths", () => assert.deepEqual(rulePatch("strong", { ...r, loras: [{ name: "a", strength: 0.4 }] }).patch.loras, [{ name: "a", strength: 0.3 }]));
test("strong floors at 0.05", () => assert.equal(rulePatch("strong", { ...r, loras: [{ name: "a", strength: 0.05 }] }).patch.loras?.[0].strength, 0.05));
test("safePatch rejects NaN, extra keys and model, clamps", () => {
  const bad = { model: "x", evil: 1, steps: NaN, cfg: 999, loras: [{ name: "a", strength: NaN }, { name: "b", strength: 9 }] } as never;
  assert.deepEqual(safePatch(r, bad), { cfg: 30, loras: [{ name: "a", strength: 0.9 }, { name: "b", strength: 2 }] });
});
test("plastic lowers cfg and adds triggers once", () => {
  const p = rulePatch("plastic", r).patch;
  assert.equal(p.cfg, 4);
  assert.match(p.prompt!, /natural skin texture/);
  assert.equal(rulePatch("plastic", { ...r, prompt: p.prompt! }).patch.prompt, p.prompt);
});
