import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSIONS } from "./core";
import { ARU_DEFAULT_TAGS, ARU_SETTINGS_KEY, mergeAruSettings, parseAruSettings, PROFILES, profileLook } from "./profiles";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { spriteDirFor, talkRequest } from "./sprites";

test("PROFILES and the setting key", () => {
  assert.deepEqual([...PROFILES], ["miyabi", "aru"]);
  assert.equal(ARU_SETTINGS_KEY, "mascot:aru");
});

test("Aru defaults: owner's description, every expression filled, no age wording", () => {
  const t = ARU_DEFAULT_TAGS;
  for (const w of ["cat ears", "cat tail", "neck bell", "collar", "blue leash", "gold earrings", "ear tag", "droopy eyes", "revealing clothes", "ladle"]) {
    assert.ok(JSON.stringify(t).includes(w), w);
  }
  assert.ok(!/\b(loli|shota|child|kid|young|teen|years? old|age)\b/i.test(JSON.stringify(t)));
  for (const e of EXPRESSIONS) assert.ok(t.exprTags[e].length > 0);
});

test("profileLook: miyabi = the active look; aru = Aru's tags + aru dir + day only", () => {
  const m = profileLook("miyabi", { ...S, spriteDir: "slimes/x" }, ARU_DEFAULT_TAGS);
  assert.deepEqual([m.charTags, m.constantTags, m.layerTags, m.exprTags, m.spriteDir, m.outfits], [S.charTags, S.constantTags, S.layerTags, S.exprTags, "slimes/x", ["day", "night", "lewd"]]);
  const a = profileLook("aru", S, { ...ARU_DEFAULT_TAGS, charTags: "mine" });
  assert.equal(a.charTags, "mine");
  assert.equal(a.spriteDir, "aru");
  assert.deepEqual(a.outfits, ["day"]);
  assert.ok(spriteDirFor(a.spriteDir));
  const base = talkRequest("day", "smug", a, 1).compiled.base;
  assert.ok(base.startsWith("mine, ") && base.includes(ARU_DEFAULT_TAGS.layerTags.day) && !base.includes("hoshimi"));
});

test("Aru settings validation: ≤1500 chars, strings only, bad fields ignored, junk json = defaults", () => {
  const ok = mergeAruSettings(ARU_DEFAULT_TAGS, { charTags: "a", layerTags: { day: "b" }, exprTags: { wink: "w", smug: 5 } });
  assert.equal(ok.charTags, "a");
  assert.equal(ok.layerTags.day, "b");
  assert.equal(ok.exprTags.wink, "w");
  assert.equal(ok.exprTags.smug, ARU_DEFAULT_TAGS.exprTags.smug);
  const bad = mergeAruSettings(ARU_DEFAULT_TAGS, { charTags: "x".repeat(1501), constantTags: 3, layerTags: { day: "y".repeat(1501), night: "z" } });
  assert.deepEqual(bad, ARU_DEFAULT_TAGS);
  assert.equal(mergeAruSettings(ARU_DEFAULT_TAGS, { charTags: "x".repeat(1500) }).charTags.length, 1500);
  assert.equal(mergeAruSettings(ARU_DEFAULT_TAGS, null), ARU_DEFAULT_TAGS);
  assert.ok(!("night" in mergeAruSettings(ARU_DEFAULT_TAGS, { layerTags: { night: "z" } }).layerTags));
  assert.deepEqual(parseAruSettings(null), ARU_DEFAULT_TAGS);
  assert.deepEqual(parseAruSettings("{nope"), ARU_DEFAULT_TAGS);
  assert.equal(parseAruSettings(JSON.stringify({ charTags: "q" })).charTags, "q");
});
