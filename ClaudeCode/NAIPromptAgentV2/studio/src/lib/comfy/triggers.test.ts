import { test } from "node:test";
import assert from "node:assert/strict";
import { addTriggers, removeTriggers } from "./triggers";

test("adds missing words in front", () => assert.deepEqual(addTriggers("sitting in a cafe", ["lenovo woman"]), { prompt: "lenovo woman, sitting in a cafe", inserted: ["lenovo woman"] }));
test("pre-typed word is neither duplicated nor removed", () => {
  const a = addTriggers("Lenovo Woman, cafe", ["lenovo woman", "detailed skin"]);
  assert.deepEqual(a, { prompt: "detailed skin, Lenovo Woman, cafe", inserted: ["detailed skin"] });
  assert.equal(removeTriggers(a.prompt, a.inserted), "Lenovo Woman, cafe");
});
test("remove leaves no stray commas", () => assert.equal(removeTriggers("a, lenovo woman, b", ["lenovo woman"]), "a, b"));
test("empty prompt", () => assert.equal(addTriggers("", ["x"]).prompt, "x"));
test("remove edits only the matched token and keeps the owner's spacing and newlines", () => assert.equal(removeTriggers("a,\nb, x", ["x"]), "a,\nb"));
test("remove with nothing inserted returns the identical prompt", () => {
  const p = "a,  b,\n c";
  assert.equal(removeTriggers(p, []), p);
  assert.equal(removeTriggers(p, ["nope"]), p);
});
test("weighted or bracketed owner words count as present", () => {
  assert.deepEqual(addTriggers("(lenovo woman:1.2), cafe", ["lenovo woman"]), { prompt: "(lenovo woman:1.2), cafe", inserted: [] });
  assert.deepEqual(addTriggers("{lenovo woman}, cafe", ["lenovo woman"]).inserted, []);
  assert.deepEqual(addTriggers("[lenovo woman], cafe", ["lenovo woman"]).inserted, []);
  assert.equal(removeTriggers("(lenovo woman:1.2), cafe", ["lenovo woman"]), "cafe");
});
