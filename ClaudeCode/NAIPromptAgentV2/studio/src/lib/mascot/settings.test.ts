import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMascotSettings, mergeMascotSettings } from "./settings";

const D = parseMascotSettings(null);

test("defaults", () => {
  assert.equal(D.show, true);
  assert.equal(D.cooldownMs, 120000);
  assert.equal(D.nightFrom, 23);
  assert.equal(D.nightTo, 7);
  assert.equal(D.pin, null);
  assert.deepEqual(D.mods, { bratty: true, tease: true, flirt: true });
  assert.equal(D.corner, "br");
  assert.match(D.charTags, /^1girl, solo, hoshimi miyabi/);
  assert.match(D.constantTags, /platform heels$/);
  assert.equal(D.layerTags.lewd, "completely nude, nipples, pussy");
  assert.equal(D.exprTags.wink, "one eye closed, tongue out, :p");
  assert.deepEqual(parseMascotSettings("garbage{"), D);
});

test("partial merge keeps the rest", () => {
  const m = mergeMascotSettings(D, { show: false, nightFrom: 21, layerTags: { day: "x" }, mods: { flirt: false } });
  assert.equal(m.show, false);
  assert.equal(m.nightFrom, 21);
  assert.equal(m.layerTags.day, "x");
  assert.equal(m.layerTags.night, D.layerTags.night);
  assert.deepEqual(m.mods, { bratty: true, tease: true, flirt: false });
  assert.equal(m.cooldownMs, 120000);
});

test("type/range checks ignore bad fields", () => {
  const m = mergeMascotSettings(D, { show: "yes", cooldownMs: 5, nightFrom: 24, nightTo: 1.5, pin: "x", corner: "mid", charTags: "a".repeat(1501), exprTags: { smug: 3, bogus: "z" } });
  assert.deepEqual(m, D);
  assert.deepEqual(mergeMascotSettings(D, null), D);
});

test("cooldown: null = only when tapped, JSON round-trips", () => {
  const m = mergeMascotSettings(D, { cooldownMs: null, pin: "night", corner: "tl" });
  assert.equal(m.cooldownMs, Infinity);
  assert.equal(m.pin, "night");
  assert.equal(mergeMascotSettings(D, { cooldownMs: 30000 }).cooldownMs, 30000);
  assert.equal(mergeMascotSettings(D, { cooldownMs: 600001 }).cooldownMs, 120000);
  assert.equal(parseMascotSettings(JSON.stringify(m)).cooldownMs, Infinity);
  assert.equal(JSON.parse(JSON.stringify(m)).cooldownMs, null);
});
