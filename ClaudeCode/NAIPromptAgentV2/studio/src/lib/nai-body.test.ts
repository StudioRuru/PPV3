import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNaiBody, DEFAULT_PARAMS } from "./nai-body";

const compiled = { base: "1girl, solo", uc: "lowres", chars: [] };

test("V5 body puts the prompt in all three places and keeps v4 captions", () => {
  // quality off / preset none / NSFW: the composer adds nothing, so the user's text comes through as-is.
  const { body, seed } = buildNaiBody({ ...compiled, rating: "nsfw", base: "nsfw, 1girl, solo" }, { ...DEFAULT_PARAMS, seed: 42, quality: "off", ucPreset: "none" }) as { body: any; seed: number };
  assert.equal(seed, 42);
  assert.equal(body.model, "nai-diffusion-5-full");
  assert.equal(body.input, "nsfw, 1girl, solo");
  assert.equal(body.parameters.prompt, "nsfw, 1girl, solo");
  assert.equal(body.parameters.v4_prompt.caption.base_caption, "nsfw, 1girl, solo");
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

const P = (b: any) => b.body.parameters;

test("parity: quality tags at the end of base, UC preset first in UC (as the web client composes them)", async () => {
  const { buildNaiBody, DEFAULT_PARAMS, UC_PRESETS } = await import("./nai-body");
  const b = buildNaiBody({ base: "1girl, smile", uc: "hat", chars: [], rating: "nsfw" }, DEFAULT_PARAMS);
  assert.equal(P(b).prompt, "nsfw, 1girl, smile, very aesthetic, masterpiece, no text");
  assert.equal(P(b).v4_prompt.caption.base_caption, P(b).prompt);
  assert.equal(P(b).negative_prompt, `${UC_PRESETS.heavy}, hat`);
  const light = buildNaiBody({ base: "1girl", uc: "", chars: [], rating: "nsfw" }, { ...DEFAULT_PARAMS, quality: "light", ucPreset: "none" });
  assert.equal(P(light).prompt, "nsfw, 1girl, very aesthetic, amazing quality, no text");
  assert.equal(P(light).negative_prompt, "");
});

test("parity: SFW puts nsfw first in UC; NSFW puts it first in base, never twice", async () => {
  const { buildNaiBody, DEFAULT_PARAMS } = await import("./nai-body");
  const p = { ...DEFAULT_PARAMS, quality: "off" as const, ucPreset: "none" as const };
  assert.equal(P(buildNaiBody({ base: "1girl", uc: "hat", chars: [], rating: "safe" }, p)).negative_prompt, "nsfw, hat");
  assert.equal(P(buildNaiBody({ base: "1girl", uc: "hat", chars: [], rating: "safe" }, p)).prompt, "1girl");
  assert.equal(P(buildNaiBody({ base: "1girl, nsfw", uc: "", chars: [], rating: "nsfw" }, p)).prompt, "1girl, nsfw");
  assert.equal(P(buildNaiBody({ base: "1girl", uc: "", chars: [], rating: "off" as never }, p)).negative_prompt, "nsfw", "old 'off' drafts behave as SFW");
});

test("parity: Furry mode starts with 'fur dataset,'; Medium effort switches model and locks its settings, sends no custom UC", async () => {
  const { buildNaiBody, DEFAULT_PARAMS, UC_PRESETS } = await import("./nai-body");
  const c = { base: "1girl", uc: "hat", chars: [{ prompt: "girl", uc: "glasses" }], rating: "nsfw" as const };
  assert.ok(P(buildNaiBody(c, { ...DEFAULT_PARAMS, mode: "furry" })).prompt.startsWith("fur dataset, nsfw, 1girl"));
  const m = buildNaiBody(c, { ...DEFAULT_PARAMS, effort: "medium", steps: 28, sampler: "k_dpmpp_2m", cfgRescale: 0.5 }).body as any;
  assert.equal(m.model, "nai-diffusion-5-full-medium");
  assert.equal(m.parameters.steps, 14);
  assert.equal(m.parameters.sampler, "k_euler_ancestral");
  assert.equal(m.parameters.cfg_rescale, 0);
  assert.equal(m.parameters.negative_prompt, UC_PRESETS.heavy);
  assert.equal(m.parameters.characterPrompts[0].uc, "");
  const curated = buildNaiBody(c, { ...DEFAULT_PARAMS, model: "nai-diffusion-5-curated", effort: "medium" }).body as any;
  assert.equal(curated.model, "nai-diffusion-5-curated", "effort is V5 Full only");
});

test("parity: the negative caption carries no coords/order (web sends false), legacy_uc false on both", async () => {
  const { buildNaiBody, DEFAULT_PARAMS } = await import("./nai-body");
  const b = buildNaiBody({ base: "2girls", uc: "", chars: [{ prompt: "girl", uc: "", center: { x: 0.2, y: 0.5 } }], rating: "nsfw" }, DEFAULT_PARAMS);
  assert.deepEqual([P(b).v4_prompt.use_coords, P(b).v4_prompt.use_order, P(b).v4_prompt.legacy_uc], [true, true, false]);
  assert.deepEqual([P(b).v4_negative_prompt.use_coords, P(b).v4_negative_prompt.use_order, P(b).v4_negative_prompt.legacy_uc], [false, false, false]);
});

test("review: nsfw detection sees weighted/braced forms, not negative ones; SFW respects an nsfw typed in base", async () => {
  const { buildNaiBody, DEFAULT_PARAMS } = await import("./nai-body");
  const p = { ...DEFAULT_PARAMS, quality: "off" as const, ucPreset: "none" as const };
  const run = (base: string, uc: string, rating: "safe" | "nsfw") => P(buildNaiBody({ base, uc, chars: [], rating }, p));
  assert.equal(run("1.2::nsfw::, 1girl", "", "nsfw").prompt, "1.2::nsfw::, 1girl");
  assert.equal(run("{nsfw}, 1girl", "", "nsfw").prompt, "{nsfw}, 1girl");
  assert.equal(run("-1::nsfw::, 1girl", "", "nsfw").prompt, "nsfw, -1::nsfw::, 1girl", "a negative weight steers away: not present");
  assert.equal(run("nsfw, 1girl", "hat", "safe").negative_prompt, "hat", "SFW with nsfw typed in base: no nsfw in UC");
});

test("review: Medium + SFW keeps nsfw in the UC even if the (discarded) user UC had it", async () => {
  const { buildNaiBody, DEFAULT_PARAMS, UC_PRESETS } = await import("./nai-body");
  const b = buildNaiBody({ base: "1girl", uc: "nsfw, hat", chars: [], rating: "safe" }, { ...DEFAULT_PARAMS, effort: "medium" });
  assert.equal(P(b).negative_prompt, `nsfw, ${UC_PRESETS.heavy}`);
});

test("review: preset and user UC are deduped; quality tags typed by hand aren't doubled", async () => {
  const { buildNaiBody, DEFAULT_PARAMS } = await import("./nai-body");
  const b = buildNaiBody({ base: "1girl, masterpiece", uc: "lowres, hat, worst quality", chars: [], rating: "nsfw" }, DEFAULT_PARAMS);
  assert.equal((P(b).negative_prompt.match(/lowres/g) ?? []).length, 1);
  assert.ok(P(b).negative_prompt.endsWith(", hat"));
  assert.equal(P(b).prompt, "nsfw, 1girl, masterpiece, very aesthetic, no text");
});

test("review: legacyParams — recipes saved before presets existed are sent as written", async () => {
  const { legacyParams, DEFAULT_PARAMS } = await import("./nai-body");
  const { quality, ucPreset, mode, effort, ...old } = DEFAULT_PARAMS;
  assert.deepEqual([legacyParams(old).quality, legacyParams(old).ucPreset], ["off", "none"]);
  assert.deepEqual([legacyParams(DEFAULT_PARAMS).quality, legacyParams(DEFAULT_PARAMS).ucPreset], ["standard", "heavy"]);
});

test("review: costOf — unknown when reads failed, overlapped, or the balance went up", async () => {
  const { costOf } = await import("./nai-body");
  assert.equal(costOf(100, 88, false), 12);
  assert.equal(costOf(100, 100, false), 0);
  assert.equal(costOf(null, 88, false), null);
  assert.equal(costOf(100, 88, true), null);
  assert.equal(costOf(100, 150, false), null);
});
