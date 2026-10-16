import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PARAMS } from "../nai-body";
import { CLIP_KINDS, CLIP_SPEC, ClipPlayer, clampMask, clipPath, clipRequests, decodeBaseKey, defaultMasks, encodeBaseKey, isBaseKey, manifestPath, validateManifest, type Manifest } from "./clips";

test("manifest validation", () => {
  const ok = { masks: { eyes: { x: 2, y: 0.5, w: 0.9, h: 0.9 } }, clips: { blink: { frames: 1, fps: 8, loop: false }, talk: { frames: 2, fps: 8, loop: true } } };
  const m = validateManifest(ok)!;
  assert.deepEqual(Object.keys(m.clips), ["blink", "talk"]);
  assert.deepEqual(m.masks!.eyes, { x: 1, y: 0.5, w: 0, h: 0.5 });
  assert.equal(validateManifest({ clips: { dance: { frames: 1, fps: 8, loop: false } } }), null);
  assert.equal(validateManifest({ clips: { blink: { frames: 2, fps: 8, loop: false } } }), null); // frames > spec
  assert.equal(validateManifest({ clips: { blink: { frames: 0, fps: 8, loop: false } } }), null);
  assert.equal(validateManifest({ clips: { blink: { frames: 1, fps: -1, loop: false } } }), null);
  assert.equal(validateManifest({ clips: { blink: { frames: 1, fps: 0, loop: false } } }), null);
  assert.equal(validateManifest({ clips: { blink: { frames: 1, fps: 8 } } }), null);
  assert.equal(validateManifest(null), null);
  assert.equal(validateManifest({}), null);
  assert.deepEqual(validateManifest({ clips: {} }), { clips: {} });
});

test("baseKey whitelist and path-safe encoding", () => {
  for (const k of ["day/smug", "lewd/full", "pose/stand/day/wink", "pose/back/night", "talk/day/talk_open"]) {
    assert.ok(isBaseKey(k), k); assert.equal(decodeBaseKey(encodeBaseKey(k)!), k);
  }
  assert.equal(encodeBaseKey("pose/back/night"), "pose~back~night");
  for (const k of ["", "../x", "day/../smug", "pose/back/night/smug", "pose/stand/day", "talk/day/zzz", "day", "day/smug/x", "/day/smug", "pose~back~night"]) assert.equal(isBaseKey(k), false, k);
  assert.equal(decodeBaseKey("..~.."), null);
  assert.equal(clipPath("/d", "day/smug", "blink", 0), "/d/clips/day~smug/blink/0.png");
  assert.equal(clipPath("/d", "day/smug", "blink", 1), null);
  assert.equal(clipPath("/d", "day/smug", "jump", 3), "/d/clips/day~smug/jump/3.png");
  assert.equal(clipPath("/d", "day/smug", "jump", 4), null);
  assert.equal(clipPath("/d", "day/smug", "jump", -1), null);
  assert.equal(clipPath("/d", "day/smug", "jump", 1.5), null);
  assert.equal(clipPath("/d", "day/smug", "../jump", 0), null);
  assert.equal(clipPath("/d", "../../etc", "blink", 0), null);
  assert.equal(manifestPath("/d", "talk/day/listen"), "/d/clips/talk~day~listen/manifest.json");
  assert.equal(manifestPath("/d", "../x"), null);
});

test("default masks per key type", () => {
  assert.deepEqual(defaultMasks("day/smug").eyes, { x: 0.32, y: 0.3, w: 0.36, h: 0.1 });
  assert.deepEqual(defaultMasks("talk/day/listen").mouth, { x: 0.4, y: 0.44, w: 0.2, h: 0.08 });
  assert.deepEqual(defaultMasks("pose/stand/day/smug").eyes, { x: 0.42, y: 0.1, w: 0.16, h: 0.04 });
  assert.deepEqual(defaultMasks("pose/back/day").mouth, { x: 0.45, y: 0.14, w: 0.1, h: 0.03 });
  assert.deepEqual(defaultMasks("day/full").mouth, { x: 0.45, y: 0.14, w: 0.1, h: 0.03 });
});

test("clampMask", () => {
  assert.deepEqual(clampMask({ x: -1, y: 2, w: 5, h: 5 }), { x: 0, y: 1, w: 1, h: 0 });
  const c = clampMask({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.ok(c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9 && c.w > 0.09);
  assert.deepEqual(clampMask({ x: NaN, y: "a", w: Infinity }), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(clampMask(null), { x: 0, y: 0, w: 0, h: 0 });
});

const base = { compiled: { base: "1girl, miyabi ", uc: "bad", chars: [], rating: "nsfw" as const }, params: { ...DEFAULT_PARAMS, seed: 1 } };
test("clipRequests: strength, tags, seed, infill per kind", () => {
  for (const kind of CLIP_KINDS) {
    const r = clipRequests(base, kind, 77), s = CLIP_SPEC[kind];
    assert.equal(r.length, s.frames);
    for (const [i, q] of r.entries()) {
      assert.equal(q.params.seed, 77);
      assert.equal(q.compiled.uc, "bad");
      assert.ok(q.compiled.base.startsWith("1girl, miyabi, ") && q.compiled.base.endsWith(s.tags[i]));
      if (s.method === "img2img") assert.deepEqual([q.img2img, q.infill], [{ strength: s.strength }, undefined]);
      else assert.deepEqual([q.img2img, q.infill, q.mask], [undefined, true, s.mask]);
    }
  }
  assert.deepEqual(CLIP_KINDS.map((k) => CLIP_SPEC[k].frames), [1, 2, 3, 3, 3, 4, 4]);
  assert.deepEqual(CLIP_KINDS.map((k) => CLIP_SPEC[k].strength), [undefined, undefined, 0.45, 0.4, 0.4, 0.5, 0.55]);
  assert.deepEqual(clipRequests(base, "talk", 1).map((q) => q.compiled.base.split(", ").slice(-2).join(", ")), ["miyabi, parted lips", "miyabi, open mouth"]);
  assert.equal(base.params.seed, 1); // input untouched
});

const clips: Manifest["clips"] = {
  blink: { frames: 1, fps: 10, loop: false }, talk: { frames: 2, fps: 8, loop: true },
  laugh: { frames: 3, fps: 10, loop: false }, wave: { frames: 4, fps: 10, loop: false },
};
test("ClipPlayer: priorities", () => {
  let s = ClipPlayer.init(clips);
  assert.deepEqual(ClipPlayer.tick(s, 0), { kind: null, frame: null });
  s = ClipPlayer.play(s, "blink", 0);
  s = ClipPlayer.play(s, "laugh", 10); // reaction pre-empts blink
  assert.equal(ClipPlayer.tick(s, 10).kind, "laugh");
  s = ClipPlayer.play(s, "blink", 20); // blink can't pre-empt a reaction
  assert.equal(ClipPlayer.tick(s, 20).kind, "laugh");
  s = ClipPlayer.play(s, "talk", 30); // talk pre-empts reaction
  assert.equal(ClipPlayer.tick(s, 30).kind, "talk");
  s = ClipPlayer.play(s, "laugh", 40); // reaction can't pre-empt talk
  assert.equal(ClipPlayer.tick(s, 40).kind, "talk");
  s = ClipPlayer.play(s, "wave", 50);
  assert.equal(ClipPlayer.tick(s, 50).kind, "talk");
});

test("ClipPlayer: one-shot returns to still, finished clip doesn't block", () => {
  let s = ClipPlayer.play(ClipPlayer.init(clips), "laugh", 1000);
  assert.deepEqual([0, 99, 100, 199, 200, 299].map((d) => ClipPlayer.tick(s, 1000 + d).frame), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(ClipPlayer.tick(s, 1300), { kind: null, frame: null });
  s = ClipPlayer.play(s, "blink", 1400); // laugh is over: blink allowed
  assert.equal(ClipPlayer.tick(s, 1400).kind, "blink");
});

test("ClipPlayer: loop until stop, replay keeps phase", () => {
  let s = ClipPlayer.play(ClipPlayer.init(clips), "talk", 0);
  assert.deepEqual([0, 125, 250, 375, 100000].map((t) => ClipPlayer.tick(s, t).frame), [0, 1, 0, 1, 0]);
  s = ClipPlayer.play(s, "talk", 130); // already looping: no restart
  assert.equal(ClipPlayer.tick(s, 130).frame, 1);
  assert.equal(ClipPlayer.stop(s, "laugh"), s);
  s = ClipPlayer.stop(s, "talk");
  assert.deepEqual(ClipPlayer.tick(s, 200), { kind: null, frame: null });
});

test("ClipPlayer: missing clip and empty slime show the still", () => {
  let s = ClipPlayer.play(ClipPlayer.init(clips), "jump", 0);
  assert.deepEqual(ClipPlayer.tick(s, 0), { kind: null, frame: null });
  s = ClipPlayer.play(ClipPlayer.init(clips), "laugh", 0);
  s = ClipPlayer.play(s, "jump", 10); // missing: current laugh untouched
  assert.equal(ClipPlayer.tick(s, 10).kind, "laugh");
  const e = ClipPlayer.play(ClipPlayer.init(clips, true), "talk", 0);
  assert.deepEqual(ClipPlayer.tick(e, 0), { kind: null, frame: null });
  assert.deepEqual(ClipPlayer.tick(ClipPlayer.play(ClipPlayer.init(), "blink", 0), 0), { kind: null, frame: null });
});
