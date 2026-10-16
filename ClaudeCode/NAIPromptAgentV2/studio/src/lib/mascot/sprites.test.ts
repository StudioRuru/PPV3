import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compose } from "../nai-body";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { BUST, BUST_UC, MASCOT_DIR, spriteDirFor, candidatePath, listSprites, newSeed, perImage, pick, saveCandidates, spritePath, spriteRequest, target } from "./sprites";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mascot-"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1]);

test("spriteRequest bust: char + constant + layer + expression + bust framing, 1024², 28 steps, per-layer seed, no ref", () => {
  const { compiled, params } = spriteRequest("night", "bust", "pout", S);
  assert.equal(compiled.base, [S.charTags, S.constantTags, S.layerTags.night, S.exprTags.pout, BUST].join(", "));
  assert.deepEqual(compiled.chars, []);
  assert.equal(compiled.uc, BUST_UC);
  assert.equal(compiled.rating, "nsfw");
  assert.equal(params.width, 1024);
  assert.equal(params.height, 1024);
  assert.equal(params.steps, 28);
  assert.equal(spriteRequest("night", "bust", "pout", S, 1234).params.seed, 1234);
  assert.ok(!("ref" in params) && !("reference" in params));
});

test("bust framing is close-up with a sprite-only UC; full has neither", () => {
  assert.equal(BUST, "portrait, close-up, head and shoulders, bust, face focus, looking at viewer, simple background, white background");
  assert.equal(BUST_UC, "full body, legs, thighs, feet, shoes, wide shot, lower body");
  const bust = spriteRequest("day", "bust", "smug", S);
  assert.ok(bust.compiled.base.includes("head and shoulders") && bust.compiled.uc.includes("thighs"));
  assert.ok(compose(bust.compiled, bust.params).c.uc.includes("thighs"));
  const full = spriteRequest("day", "full", "smug", S);
  assert.ok(full.compiled.base.includes("full body") && full.compiled.uc === "");
});

test("each draw gets a fresh seed in 1..2^32-1", () => {
  const seeds = Array.from({ length: 20 }, () => newSeed());
  assert.ok(new Set(seeds).size > 1);
  for (const x of seeds) assert.ok(Number.isInteger(x) && x >= 1 && x <= 2 ** 32 - 1);
  assert.notEqual(spriteRequest("day", "bust", "smug", S).params.seed, spriteRequest("day", "bust", "smug", S).params.seed);
});

test("spriteRequest full: full-body framing, no expression tags, 832×1216", () => {
  const { compiled, params } = spriteRequest("day", "full", "pout", S);
  assert.equal(compiled.base, [S.charTags, S.constantTags, S.layerTags.day, "full body, standing, hand on hip, looking at viewer, simple background, white background"].join(", "));
  assert.ok(compiled.base.includes("white background"));
  assert.ok(!compiled.base.includes(S.exprTags.pout));
  assert.equal(params.width, 832);
  assert.equal(params.height, 1216);
  assert.equal(params.steps, 28);
});

test("perImage: free at ≤1 Mpx and ≤28 steps, else unknown", () => {
  assert.equal(perImage(spriteRequest("day", "bust", "smug", S).params), 0);
  assert.equal(perImage(spriteRequest("day", "full", "smug", S).params), 0);
  assert.equal(perImage({ ...spriteRequest("day", "full", "smug", S).params, steps: 29 }), null);
  assert.equal(perImage({ ...spriteRequest("day", "full", "smug", S).params, width: 1216, height: 1216 }), null);
});

test("name whitelist rejects traversal and unknown names", () => {
  const d = "/x";
  assert.equal(spritePath(d, "day", "smug"), path.join(d, "day", "smug.png"));
  assert.equal(spritePath(d, "lewd", "full"), path.join(d, "lewd", "full.png"));
  for (const [o, n] of [["..", "smug"], ["day", "../smug"], ["day", "smug.png"], ["day/..", "smug"], ["evil", "smug"], ["day", "angry"], ["day", ""]]) {
    assert.equal(spritePath(d, o, n), null, `${o}/${n}`);
  }
  assert.equal(candidatePath(d, "day", "smug", 0), path.join(d, "candidates", "day", "smug", "0.png"));
  for (const i of [-1, 4, 1.5, NaN]) assert.equal(candidatePath(d, "day", "smug", i), null);
  assert.equal(candidatePath(d, "day", "../x", 0), null);
});

test("target parses outfit/kind/expr; full ignores expr; bad input null", () => {
  assert.deepEqual(target({ outfit: "day", kind: "bust", expr: "wink" }), { outfit: "day", kind: "bust", expr: "wink", name: "wink" });
  assert.deepEqual(target({ outfit: "night", kind: "full", expr: "nope" }), { outfit: "night", kind: "full", expr: "smug", name: "full" });
  assert.deepEqual(target({ outfit: "day", expr: "wink" }), { outfit: "day", kind: "bust", expr: "wink", name: "wink" });
  assert.equal(target({ outfit: "day", kind: "bust", expr: "../x" }), null);
  assert.equal(target({ outfit: "x", kind: "bust", expr: "wink" }), null);
  assert.equal(target(null), null);
});

test("pick never writes when the candidate is missing", async () => {
  const d = tmp();
  let called = false;
  const r = await pick(d, "day", "smug", 0, async () => { called = true; return new Response(PNG); });
  assert.ok("error" in r);
  assert.equal(called, false);
  assert.equal(fs.existsSync(path.join(d, "day")), false);
});

test("pick saves cutout + .orig, or keeps original with a note when cutout fails", async () => {
  const d = tmp();
  saveCandidates(d, "day", "smug", [PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 9])]);
  const cut = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 7]);
  let sent: FormData | null = null;
  const ok = await pick(d, "day", "smug", 0, async (_u, init) => { sent = init?.body as FormData; return new Response(cut, { headers: { "Content-Type": "image/png" } }); });
  assert.deepEqual(ok, { ok: true });
  assert.ok((sent as FormData | null)?.get("file") instanceof Blob);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.png")), cut);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.orig.png")), PNG);

  // cutout down with an existing sprite: error, sprite and candidate untouched
  const down = await pick(d, "day", "smug", 1, async () => { throw new Error("ECONNREFUSED"); });
  assert.ok("error" in down && /kept your current sprite/.test(down.error));
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.png")), cut);
  assert.ok(fs.existsSync(candidatePath(d, "day", "smug", 1)!));

  // no sprite yet: fallback saves the original + note
  const d2 = tmp();
  saveCandidates(d2, "day", "smug", [PNG]);
  const bad = await pick(d2, "day", "smug", 0, async () => new Response("nope", { status: 500 }));
  assert.ok("note" in bad && bad.ok);
  assert.deepEqual(fs.readFileSync(path.join(d2, "day", "smug.png")), PNG);
});

test("saveCandidates replaces the old batch; listSprites reports sprites (mtime) and sheets", () => {
  const d = tmp();
  saveCandidates(d, "night", "full", [PNG, PNG, PNG]);
  saveCandidates(d, "night", "full", [PNG]);
  assert.deepEqual(fs.readdirSync(path.join(d, "candidates", "night", "full")), ["0.png"]);
  saveCandidates(d, "night", "full", [PNG, PNG, PNG], [5, 6, 7]);
  saveCandidates(d, "night", "full", [PNG, PNG], [8, 9]);
  const cd = path.join(d, "candidates", "night", "full");
  assert.deepEqual(fs.readdirSync(cd).sort(), ["0.png", "1.png", "meta.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cd, "meta.json"), "utf8")), { seeds: [8, 9] });
  fs.mkdirSync(path.join(d, "day"), { recursive: true });
  fs.writeFileSync(path.join(d, "day", "smug.png"), PNG);
  fs.writeFileSync(path.join(d, "day", "smug.orig.png"), PNG);
  fs.writeFileSync(path.join(d, "day", "evil.png"), PNG);
  fs.mkdirSync(path.join(d, "sheets"));
  fs.writeFileSync(path.join(d, "sheets", "lewd.png"), PNG);
  const l = listSprites(d);
  assert.deepEqual(Object.keys(l.sprites), ["day/smug"]);
  assert.equal(typeof l.sprites["day/smug"], "number");
  assert.deepEqual(l.sheets, { day: false, night: false, lewd: true });
  assert.deepEqual(listSprites(path.join(d, "missing")), { sprites: {}, sheets: { day: false, night: false, lewd: false }, clips: {}, clipMeta: {} });
});

test("spriteDirFor: look.spriteDir under data/mascot (\"\" = root); traversal rejected", () => {
  assert.equal(spriteDirFor(""), MASCOT_DIR);
  assert.equal(spriteDirFor("slimes/3"), path.join(MASCOT_DIR, "slimes", "3"));
  for (const d of ["..", "../x", "a/../../b", "/etc", "a\\b", "slimes/./../.."]) assert.equal(spriteDirFor(d), null, d);
});

// --- clip pipeline (Plan 22 Task 2) ---
import sharp from "sharp";
import { CLIP_SPEC, clipPath, manifestPath } from "./clips";
import { clipCandidatePath, generateClip, keyRequest, maskPng, pickClip, readManifest, saveClipMasks } from "./sprites";

const solid = (w: number, h: number, alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 100, b: 50, alpha } } }).png().toBuffer();

test("maskPng: base size, white box on black at the normalised position", async () => {
  const png = await maskPng(100, 200, { x: 0.2, y: 0.5, w: 0.3, h: 0.1 });
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [100, 200]);
  const at = (x: number, y: number) => data[(y * info.width + x) * info.channels];
  assert.equal(at(25, 105), 255); // inside
  assert.equal(at(20, 100), 255); // top-left corner
  assert.equal(at(49, 119), 255); // bottom-right corner
  assert.equal(at(19, 105), 0);
  assert.equal(at(50, 105), 0);
  assert.equal(at(25, 99), 0);
  assert.equal(at(25, 120), 0);
});

test("keyRequest rebuilds the base sprite's request from its key", () => {
  assert.equal(keyRequest("day/smug", S)!.params.width, 1024);
  assert.equal(keyRequest("day/full", S)!.params.height, 1216);
  assert.ok(keyRequest("talk/day/smug", S)!.compiled.base.length);
  assert.ok(keyRequest("pose/back/day", S));
  assert.equal(keyRequest("../x", S), null);
});

async function seedBust(d: string, orig = true) {
  fs.mkdirSync(path.join(d, "day"), { recursive: true });
  fs.writeFileSync(path.join(d, "day", "smug.png"), await solid(1024, 1024, 0.5));
  if (orig) fs.writeFileSync(path.join(d, "day", "smug.orig.png"), await solid(1024, 1024));
}

test("clip generate → candidates → pick → aligned frames + manifest; infill sends a mask, img2img a strength", async () => {
  const d = tmp();
  await seedBust(d);
  const calls: { p: any; i2i?: any; inf?: any }[] = [];
  const gen = async (_c: any, p: any, i2i?: any, inf?: any) => { calls.push({ p, i2i, inf }); return solid(1024, 1024); };
  // nudged mouth mask is used
  saveClipMasks(d, "day/smug", { mouth: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, nose: 1 });
  const r = await generateClip(d, "day/smug", "talk", S, 2, gen);
  assert.equal(r.count, 4);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.inf && !c.i2i && c.p.width === 1024));
  assert.equal(calls[0].p.seed, calls[1].p.seed); // same seed within a clip
  const mask = await sharp(Buffer.from(calls[0].inf.mask, "base64")).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(mask.data[(550 * 1024 + 550) * mask.info.channels], 255);
  assert.equal(mask.data[(300 * 1024 + 300) * mask.info.channels], 0);
  assert.ok(fs.existsSync(clipCandidatePath(d, "day/smug", "talk", 1, 1)!));

  calls.length = 0;
  await generateClip(d, "day/smug", "laugh", S, 1, gen);
  assert.ok(calls.every((c) => c.i2i?.strength === CLIP_SPEC.laugh.strength && c.i2i.noise === 0 && !c.inf));

  // pick: cut via tagger, written onto the base canvas; manifest records the clip; masks kept
  const cut = await solid(1024, 1024, 0.7);
  const ok = await pickClip(d, "day/smug", "talk", 1, async () => new Response(new Uint8Array(cut)));
  assert.deepEqual(ok, { ok: true });
  for (const n of [0, 1]) {
    const m = await sharp(clipPath(d, "day/smug", "talk", n)!).metadata();
    assert.deepEqual([m.width, m.height, m.hasAlpha], [1024, 1024, true]);
  }
  const man = readManifest(d, "day/smug");
  assert.deepEqual(man.clips.talk, { frames: 2, fps: 8, loop: true });
  assert.deepEqual(man.masks?.mouth, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  const l = listSprites(d) as any;
  assert.deepEqual(l.clips, { "day/smug": { talk: 2 } });
  assert.equal(typeof l.clipMeta["day/smug"].v, "number");
});

test("clip pick: a mis-sized cutout is scaled onto the base canvas; cutout down writes nothing", async () => {
  const d = tmp();
  await seedBust(d, false); // no .orig: the cut sprite on white is the source
  await generateClip(d, "day/smug", "blink", S, 1, async () => solid(1024, 1024));
  const down = await pickClip(d, "day/smug", "blink", 0, async () => { throw new Error("ECONNREFUSED"); });
  assert.ok("error" in down);
  assert.equal(fs.existsSync(clipPath(d, "day/smug", "blink", 0)!), false);
  assert.equal(fs.existsSync(manifestPath(d, "day/smug")!), false);
  const small = await solid(512, 512);
  assert.deepEqual(await pickClip(d, "day/smug", "blink", 0, async () => new Response(new Uint8Array(small))), { ok: true });
  assert.equal((await sharp(clipPath(d, "day/smug", "blink", 0)!).metadata()).width, 1024);
});

test("clip generate: stop on first error / abort, nothing replaced; missing base or bad input rejected", async () => {
  const d = tmp();
  await seedBust(d);
  await generateClip(d, "day/smug", "pout", S, 1, async () => solid(1024, 1024));
  const before = fs.readFileSync(clipCandidatePath(d, "day/smug", "pout", 0, 0)!);
  let calls = 0;
  await assert.rejects(generateClip(d, "day/smug", "pout", S, 2, async () => { if (++calls === 2) throw new Error("402"); return solid(1024, 1024, 0.2); }), /402/);
  assert.equal(calls, 2);
  assert.deepEqual(fs.readFileSync(clipCandidatePath(d, "day/smug", "pout", 0, 0)!), before);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(generateClip(d, "day/smug", "pout", S, 1, async () => solid(1024, 1024), ac.signal), /Stopped/);
  await assert.rejects(generateClip(d, "night/smug", "pout", S, 1, async () => solid(1024, 1024)), /sprite/i);
  await assert.rejects(generateClip(d, "day/smug", "dance" as any, S, 1, async () => solid(1024, 1024)));
  assert.equal(clipCandidatePath(d, "day/smug", "pout", 0, 3), null);
  assert.equal(clipCandidatePath(d, "../../etc", "pout", 0, 0), null);
  assert.equal(clipCandidatePath(d, "day/smug", "pout", 4, 0), null);
  assert.ok("error" in await pickClip(d, "day/smug", "wink", 0, async () => new Response("")));
});

test("re-picking a base sprite clears its stale clips and clip candidates; nudged masks kept", async () => {
  const d = tmp();
  await seedBust(d);
  saveClipMasks(d, "day/smug", { eyes: { x: 0.3, y: 0.3, w: 0.2, h: 0.1 } });
  await generateClip(d, "day/smug", "blink", S, 1, async () => solid(1024, 1024));
  await pickClip(d, "day/smug", "blink", 0, async () => new Response(new Uint8Array(await solid(1024, 1024))));
  await generateClip(d, "day/smug", "blink", S, 1, async () => solid(1024, 1024));
  assert.deepEqual((listSprites(d) as any).clips["day/smug"], { blink: 1 });
  saveCandidates(d, "day", "smug", [await solid(1024, 1024)]);
  assert.deepEqual(await pick(d, "day", "smug", 0, async () => new Response(new Uint8Array(await solid(1024, 1024)))), { ok: true });
  assert.equal(fs.existsSync(clipPath(d, "day/smug", "blink", 0)!), false);
  assert.equal(fs.existsSync(clipCandidatePath(d, "day/smug", "blink", 0, 0)!), false);
  assert.deepEqual((listSprites(d) as any).clips["day/smug"], {});
  assert.deepEqual(readManifest(d, "day/smug"), { clips: {}, masks: { eyes: { x: 0.3, y: 0.3, w: 0.2, h: 0.1 } } });
});
