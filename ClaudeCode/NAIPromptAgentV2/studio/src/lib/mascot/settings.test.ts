import { test } from "node:test";
import assert from "node:assert/strict";
import { clientSettingsPatch, parseMascotSettings, mergeMascotSettings } from "./settings";

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

test("size: default m; accepts s/m/l, rejects others", () => {
  assert.equal(D.size, "m");
  for (const s of ["s", "m", "l"]) assert.equal(mergeMascotSettings(D, { size: s }).size, s);
  for (const s of ["xl", "", 2, null]) assert.equal(mergeMascotSettings({ ...D, size: "l" }, { size: s }).size, "l");
});

test("identity defaults: miyabi voice, name, sliders, no heat drift, root sprite dir, not empty", () => {
  assert.match(D.voice, /Hoshimi Miyabi/);
  assert.equal(D.selfName, "Miyabi");
  assert.deepEqual(D.sliders, { brat: { value: 6, cap: 10 }, bimbo: { value: 0, cap: 10 }, hypnosis: { value: 0, cap: 10 }, heat: { value: 0, cap: 10 }, length: { value: 4, cap: 10 } });
  assert.equal(D.heatDrift, false);
  assert.equal(D.spriteDir, "");
  assert.equal(D.empty, false);
});

test("identity fields validate: per-slider, caps, sprite dir whitelist", () => {
  const m = mergeMascotSettings(D, { voice: "meek", selfName: "Kit", heatDrift: true, empty: true, spriteDir: "slimes/3",
    sliders: { brat: { value: 2, cap: 4, live: 3 }, heat: { value: 5, cap: 4 }, bimbo: "x" } });
  assert.equal(m.voice, "meek");
  assert.equal(m.selfName, "Kit");
  assert.equal(m.heatDrift, true);
  assert.equal(m.empty, true);
  assert.equal(m.spriteDir, "slimes/3");
  assert.deepEqual(m.sliders.brat, { value: 2, cap: 4, live: 3 });
  assert.deepEqual(m.sliders.heat, D.sliders.heat, "cap < value rejected");
  assert.deepEqual(m.sliders.bimbo, D.sliders.bimbo);
  const bad = mergeMascotSettings(D, { voice: "v".repeat(1501), selfName: "n".repeat(41), heatDrift: "yes", sliders: { brat: { value: 11, cap: 11 } } });
  assert.deepEqual(bad, D);
  for (const d of ["../x", "a/../b", "/abs", "a\\b", 3]) assert.equal(mergeMascotSettings(D, { spriteDir: d }).spriteDir, "", String(d));
  assert.deepEqual(mergeMascotSettings(D, { sliders: { brat: { value: 1, cap: 2, live: 3 } } }).sliders.brat, { value: 1, cap: 2 }, "live above cap dropped");
});

test("client patches can't set empty or live drift; moving a slider resets drift", () => {
  const p = clientSettingsPatch({ empty: true, show: false, sliders: { brat: { value: 3, cap: 8, live: 8 }, heat: "x" } }) as Record<string, unknown>;
  assert.equal("empty" in p, false);
  const drifted = { ...D, sliders: { ...D.sliders, brat: { value: 6, cap: 10, live: 9 } } };
  const m = mergeMascotSettings(drifted, p);
  assert.deepEqual(m.sliders.brat, { value: 3, cap: 8 });
  assert.equal(m.show, false);
  assert.equal(m.empty, false);
  assert.equal(clientSettingsPatch(null), null);
});

test("shelf unlock: default off, boolean only", () => {
  assert.equal(D.shelf, false);
  assert.equal(mergeMascotSettings(D, { shelf: true }).shelf, true);
  assert.equal(mergeMascotSettings(D, { shelf: "yes" }).shelf, false);
});

test("final review: first run (no saved sliders) follows the bratty mod; saved sliders win", () => {
  assert.equal(parseMascotSettings(JSON.stringify({ mods: { bratty: false } })).sliders.brat.value, 0);
  assert.equal(parseMascotSettings(JSON.stringify({ mods: { bratty: true } })).sliders.brat.value, 6);
  assert.equal(parseMascotSettings(null).sliders.brat.value, 6);
  assert.equal(parseMascotSettings(JSON.stringify({ mods: { bratty: false }, sliders: { brat: { value: 3, cap: 10 } } })).sliders.brat.value, 3);
});

test("vials: default [], validated as applied vials (≤8), client patches can't set them", () => {
  const ok = { name: "Brew", color: "#123456", effect: "e", doses: [{ seq: 0, delta: { brat: { value: 1, cap: 0 } } }] };
  assert.deepEqual(D.vials, []);
  assert.deepEqual(mergeMascotSettings(D, { vials: [ok] }).vials, [ok]);
  assert.deepEqual(mergeMascotSettings(D, { vials: [ok, { name: "bad" }] }).vials, [], "any invalid vial rejects the field");
  assert.deepEqual(mergeMascotSettings(D, { vials: new Array(9).fill(ok) }).vials, []);
  assert.deepEqual(mergeMascotSettings(D, { vials: "x" }).vials, []);
  assert.equal("vials" in (clientSettingsPatch({ vials: [ok], show: true }) as object), false);
});
