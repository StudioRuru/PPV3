import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNaiBody, DEFAULT_PARAMS } from "./nai-body";

const compiled = { base: "1girl, solo", uc: "lowres", chars: [] };

test("V5 body puts the prompt in all three places and keeps v4 captions", () => {
  const { body, seed } = buildNaiBody(compiled, { ...DEFAULT_PARAMS, seed: 42 }) as { body: any; seed: number };
  assert.equal(seed, 42);
  assert.equal(body.model, "nai-diffusion-5-full");
  assert.equal(body.input, "1girl, solo");
  assert.equal(body.parameters.prompt, "1girl, solo");
  assert.equal(body.parameters.v4_prompt.caption.base_caption, "1girl, solo");
  assert.equal(body.parameters.v4_negative_prompt.caption.base_caption, "lowres");
  assert.equal(body.parameters.params_version, 4);
  assert.equal(body.parameters.n_samples, 1);
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions, []);
});

test("characters fill char captions, characterPrompts and coords flag", () => {
  const c = { ...compiled, chars: [
    { prompt: "girl, red hair", uc: "hat" },
    { prompt: "boy", uc: "", center: { x: 0.7, y: 0.5 } },
  ] };
  const { body } = buildNaiBody(c, { ...DEFAULT_PARAMS, seed: 1 }) as { body: any };
  const p = body.parameters;
  assert.equal(p.v4_prompt.use_coords, true);
  assert.equal(p.v4_prompt.use_order, true);
  assert.deepEqual(p.v4_prompt.caption.char_captions[1], { char_caption: "boy", centers: [{ x: 0.7, y: 0.5 }] });
  assert.deepEqual(p.v4_negative_prompt.caption.char_captions[0], { char_caption: "hat", centers: [{ x: 0.5, y: 0.5 }] });
  assert.equal(p.characterPrompts.length, 2);
});

test("random seed when none given", () => {
  const { seed } = buildNaiBody(compiled, DEFAULT_PARAMS);
  assert.ok(Number.isInteger(seed) && seed > 0);
});
