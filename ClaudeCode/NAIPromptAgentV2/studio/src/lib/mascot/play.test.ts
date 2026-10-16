import assert from "node:assert/strict";
import test from "node:test";
import { canRestore, clipsFor, clipUrl, clipUrls, reactionFor, texSize } from "./play";

const L = { clips: { "day/smug": { talk: 2, blink: 1, wave: 2, laugh: 9 } as never, "pose/stand/day/smug": { jump: 4 } }, clipMeta: { "day/smug": { v: 7 }, "pose/stand/day/smug": { v: 3 } } };

test("clipsFor: listing frames with spec fps/loop, bad counts and kinds dropped", () => {
  assert.deepEqual(clipsFor(L, "day/smug"), { talk: { frames: 2, fps: 8, loop: true }, blink: { frames: 1, fps: 5.5, loop: false }, wave: { frames: 2, fps: 6, loop: false } });
  assert.deepEqual(clipsFor({ clips: { "day/smug": { nope: 1, pout: 0 } as never }, clipMeta: {} }, "day/smug"), {});
  assert.deepEqual(clipsFor(L, "day/pout"), {});
  assert.deepEqual(clipsFor(null, null), {});
});

test("clipUrl: encoded key, whitelisted kind/frame, cache-bust and profile", () => {
  assert.equal(clipUrl(L, "pose/stand/day/smug", "jump", 3), "/api/mascot/sprites/clips/pose~stand~day~smug/jump/3?v=3");
  assert.equal(clipUrl(L, "day/smug", "talk", 1, true), "/api/mascot/sprites/clips/day~smug/talk/1?v=7&profile=aru");
  assert.equal(clipUrl(L, "../etc", "talk", 0), null);
  assert.equal(clipUrl(L, "day/smug", "talk", 2), null);
  assert.equal(clipUrl(L, "day/smug", "nope" as never, 0), null);
});

test("clipUrls: every picked frame of one base sprite (preload)", () => {
  assert.deepEqual(clipUrls(L, "pose/stand/day/smug").map((u) => u.split("?")[0].split("/").slice(-2).join("/")), ["jump/0", "jump/1", "jump/2", "jump/3"]);
  assert.equal(clipUrls(L, "day/smug").length, 5);
  assert.deepEqual(clipUrls(L, null), []);
});

test("reactionFor: the playback table", () => {
  assert.equal(reactionFor("poke", "laughing", () => 0), "laugh");
  assert.equal(reactionFor("poke", "annoyed", () => 0), "pout");
  assert.equal(reactionFor("pat", "smug", () => 0), "wink");
  assert.equal(reactionFor("flick", "smug", () => 0), "pout");
  assert.equal(reactionFor("drop", "smug", () => 0), "pout");
  for (const e of ["generated", "upscaled", "vial_drop", "brewed"] as const) {
    assert.equal(reactionFor(e, "smug", () => 0.1), "jump");
    assert.equal(reactionFor(e, "smug", () => 0.9), "wave");
  }
});

test("fix1 texSize: contain-fit into the backing box, never upscaled, integer ≥ 1", () => {
  assert.deepEqual(texSize(832, 1216, 400, 600), { w: 400, h: 585 });
  assert.deepEqual(texSize(832, 1216, 2000, 2000), { w: 832, h: 1216 });
  assert.deepEqual(texSize(1216, 832, 300, 900), { w: 300, h: 205 });
  assert.deepEqual(texSize(832, 1216, 0, 0), { w: 832, h: 1216 }); // not laid out yet: full size
  assert.deepEqual(texSize(10, 10000, 50, 50), { w: 1, h: 50 });
});

test("fix1 canRestore: at most 3 context losses per minute", () => {
  assert.equal(canRestore([], 0), true);
  assert.equal(canRestore([1000, 2000], 3000), true);
  assert.equal(canRestore([1000, 2000, 3000], 4000), false);
  assert.equal(canRestore([1000, 2000, 3000], 3000 + 60_000), true); // old losses age out
});
