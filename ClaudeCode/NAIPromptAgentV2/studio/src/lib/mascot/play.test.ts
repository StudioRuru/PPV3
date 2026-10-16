import assert from "node:assert/strict";
import test from "node:test";
import { clipsFor, clipUrl, clipUrls, reactionFor } from "./play";

const L = { clips: { "day/smug": { talk: 2, blink: 1, wave: 2, laugh: 9 } as never, "pose/stand/day/smug": { jump: 4 } }, clipMeta: { "day/smug": { v: 7 }, "pose/stand/day/smug": { v: 3 } } };

test("clipsFor: listing frames with spec fps/loop, bad counts and kinds dropped", () => {
  assert.deepEqual(clipsFor(L, "day/smug"), { talk: { frames: 2, fps: 8, loop: true }, blink: { frames: 1, fps: 8, loop: false }, wave: { frames: 2, fps: 6, loop: false } });
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
