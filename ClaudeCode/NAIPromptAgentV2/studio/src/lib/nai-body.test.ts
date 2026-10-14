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

test("model picker is V5-only", async () => {
  const { MODELS } = await import("./nai-body");
  assert.deepEqual(MODELS.map((m) => m.id), ["nai-diffusion-5-full", "nai-diffusion-5-curated"]);
});

test("schedulesFor: every listed sampler has valid schedules; fixSchedule snaps an invalid one", async () => {
  const { SAMPLERS, schedulesFor, fixSchedule, DEFAULT_PARAMS } = await import("./nai-body");
  assert.ok(SAMPLERS.length >= 6);
  for (const s of SAMPLERS) assert.ok(schedulesFor(s.id).length > 0, s.id);
  assert.deepEqual(schedulesFor("k_euler_ancestral"), ["karras", "exponential", "polyexponential"]);
  assert.equal(fixSchedule({ ...DEFAULT_PARAMS, sampler: "k_dpmpp_2m", noiseSchedule: "native" }).noiseSchedule, "karras");
  assert.equal(fixSchedule({ ...DEFAULT_PARAMS, noiseSchedule: "exponential" }).noiseSchedule, "exponential");
});

test("img2img body: action, image, strength, noise and the source size", async () => {
  const { buildNaiBody, DEFAULT_PARAMS } = await import("./nai-body");
  const c = { base: "1girl", uc: "", chars: [] };
  const { body } = buildNaiBody(c, { ...DEFAULT_PARAMS, seed: 7 }, { image: "QUJD", strength: 0.45, noise: 0 });
  assert.equal(body.action, "img2img");
  const p = body.parameters as Record<string, unknown>;
  assert.equal(p.image, "QUJD");
  assert.equal(p.strength, 0.45);
  assert.equal(p.noise, 0);
  assert.equal(p.extra_noise_seed, 7);
  assert.equal(buildNaiBody(c, DEFAULT_PARAMS).body.action, "generate");
  assert.equal("image" in buildNaiBody(c, DEFAULT_PARAMS).body.parameters, false);
});

test("review: upscaled or oversized images can't be re-sent as a recipe or img2img source", async () => {
  const { canResend, DEFAULT_PARAMS } = await import("./nai-body");
  assert.equal(canResend(DEFAULT_PARAMS), true);
  assert.equal(canResend({ ...DEFAULT_PARAMS, upscaled: 4 }), false);
  assert.equal(canResend({ ...DEFAULT_PARAMS, width: 3328, height: 4864 }), false);
});
