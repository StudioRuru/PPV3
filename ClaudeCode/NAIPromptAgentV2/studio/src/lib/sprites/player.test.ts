import { test } from "node:test";
import assert from "node:assert/strict";
import type { LibClip, Library } from "./core";
import { dropLoopSeam, frameAt, initial, request, route, tick } from "./player";
import { parseQuip } from "../mascot/core";

const clip = (from: string, to: string, extra: Partial<LibClip> = {}): LibClip => ({ surface: "chat", outfit: "day", from, to, frames: 13, fps: 30, w: 480, h: 832, v: 1, ...extra });
const idles = ["happy", "sad", "annoyed", "sleepy"].map((k) => clip(k, k, { frames: 41 }));
const lib = (...c: LibClip[]): Library => ({ outfits: ["day"], keys: [], edges: [], clips: [...idles, ...c] });
const L = lib(clip("happy", "sad"), clip("sad", "happy", { reverseOf: "happy~sad" }), clip("sad", "sleepy"));

test("route prefers own clip, then mirror reversed, else crossfade", () => {
  const own = route(L, "chat", "day", "happy", "sad");
  assert.ok(own !== "crossfade" && !own.reversed && !own.loop);
  const rev = route(L, "chat", "day", "sad", "happy"); // listed reverse cell: mirror frames, played backwards
  assert.ok(rev !== "crossfade" && rev.reversed && rev.clip.reverseOf === "happy~sad");
  const bare = route(lib(clip("happy", "sad")), "chat", "day", "sad", "happy");
  assert.ok(bare !== "crossfade" && bare.reversed && bare.clip.from === "happy");
  assert.equal(route(L, "chat", "day", "happy", "annoyed"), "crossfade");
  assert.equal(route(L, "chat", "night", "happy", "sad"), "crossfade");
});

test("request during a transition queues only the latest target", () => {
  let s = request(initial(L, "day", "happy", 0), "sad", L, "day", 0);
  assert.equal(s.seg?.loop, false);
  s = request(s, "annoyed", L, "day", 100); s = request(s, "sleepy", L, "day", 200);
  assert.equal(s.pending, "sleepy");
  assert.equal(request(s, "sad", L, "day", 250).pending, null); // back to the arrival: nothing to chain
});

test("tick chains pending transition from the arrival expression, then idles", () => {
  let s = request(initial(L, "day", "happy", 0), "sad", L, "day", 0);
  s = request(s, "sleepy", L, "day", 100);
  s = tick(s, L, "day", 200);
  assert.equal(s.seg?.clip.to, "sad"); // still running (13f @30fps = 433ms)
  s = tick(s, L, "day", 500);
  assert.deepEqual([s.seg?.clip.from, s.seg?.clip.to, s.at], ["sad", "sleepy", "sleepy"]);
  s = tick(s, L, "day", 1000);
  assert.deepEqual([s.seg?.clip.from, s.seg?.clip.to, s.seg?.loop], ["sleepy", "sleepy", true]);
});

test("missing transition yields crossfade and lands on target idle", () => {
  const s = request(initial(L, "day", "happy", 0), "annoyed", L, "day", 10);
  assert.deepEqual([s.at, s.seg?.loop, s.seg?.clip.to, s.pending], ["annoyed", true, "annoyed", null]);
});

test("frameAt never returns an index past the last frame; idle wraps at n-1", () => {
  const t = request(initial(L, "day", "happy", 0), "sad", L, "day", 0);
  assert.equal(frameAt(t, 0)?.index, 0);
  assert.equal(frameAt(t, 99_999)?.index, 12);
  const rev = request(initial(L, "day", "sad", 0), "happy", L, "day", 0);
  assert.deepEqual([frameAt(rev, 0)?.index, frameAt(rev, 99_999)?.index], [12, 0]);
  const i = initial(L, "day", "happy", 0);
  assert.equal(dropLoopSeam(41), 40);
  for (const ms of [0, 1333, 1334, 5000, 123_456]) { const f = frameAt(i, ms)!.index; assert.ok(f >= 0 && f <= 39); }
  assert.equal(frameAt(i, 1334)?.index, 0); // 40 frames @30fps wraps at 1333.3ms
  assert.equal(frameAt({ at: "x", seg: null, startedAt: 0, pending: null }, 5), null);
});

test("parseQuip maps legacy expression keys", () => {
  const keys = ["neutral", "happy", "smug", "pouty", "horny", "surprised", "annoyed", "sleepy", "laughing"];
  assert.equal(parseQuip("[wink] hi", keys)?.expression, "smug");
  assert.equal(parseQuip("[pout] hi", keys)?.expression, "pouty");
  assert.equal(parseQuip("[flirty] hi", keys)?.expression, "horny");
  assert.equal(parseQuip("[shocked] hi", keys)?.expression, "surprised");
  assert.equal(parseQuip("[excited] hi", keys)?.expression, "happy");
  assert.equal(parseQuip("[sleepy] hi", keys)?.expression, "sleepy");
  assert.equal(parseQuip("[yandere] hi", keys)?.expression, "smug"); // unknown key
  assert.equal(parseQuip("[yandere] hi", [...keys, "yandere"])?.expression, "yandere");
});

test("stage route follows next hop; missing edge clip crossfades", () => {
  const sc = (from: string, to: string, extra: Partial<LibClip> = {}) => clip(from, to, { surface: "stage", frames: from === to ? 41 : 41, ...extra });
  const S = { outfits: ["day"], keys: [], edges: [["stand", "sit"], ["sit", "lie_down"]] as [string, string][], clips: [sc("stand", "stand"), sc("sit", "sit"), sc("lie_down", "lie_down"), sc("stand", "sit")] };
  let s = request(initial(S, "day", "stand", 0, "stage"), "sit", S, "day", 0, "stage");
  assert.deepEqual([s.seg?.clip.surface, s.seg?.clip.from, s.seg?.clip.to, s.seg?.loop], ["stage", "stand", "sit", false]);
  s = tick(s, S, "day", 5000, "stage");
  assert.deepEqual([s.seg?.clip.from, s.seg?.loop, s.at], ["sit", true, "sit"]);
  s = request(s, "lie_down", S, "day", 5000, "stage"); // sit~lie_down not approved
  assert.deepEqual([s.seg?.clip.to, s.seg?.loop, s.at], ["lie_down", true, "lie_down"]);
  assert.equal(initial(S, "day", "stand", 0).seg, null); // default surface stays chat
});
