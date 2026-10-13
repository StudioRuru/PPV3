import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newTags, tipoPrompt } from "./tipo";

test("tipoPrompt leaves the tag line open so TIPO continues it", () => {
  assert.equal(tipoPrompt("1girl, red hair", "nsfw"), "quality: masterpiece, newest\nrating: nsfw\ntarget: <|long|>\ntag: 1girl, red hair");
  assert.match(tipoPrompt("x", "safe"), /rating: safe/);
  assert.doesNotMatch(tipoPrompt("x", "off"), /rating:/);
});

test("newTags keeps only new, unique tags from the continuation and tag lines, capped", () => {
  const out = ", 1girl, red hair, smile, smile, thighhighs\nlong: A girl smiles.\nquality: masterpiece\ntag: <|junk|>, blush";
  assert.deepEqual(newTags(out, "1girl, Red Hair"), ["smile", "thighhighs", "blush"]);
  assert.equal(newTags(", " + Array.from({ length: 30 }, (_, i) => `t${i}`).join(", "), "").length, 12);
});

test("newTags reads the real captured TIPO output", () => {
  const raw = fs.readFileSync(new URL("./fixtures/tipo-out.txt", import.meta.url), "utf8");
  const tags = newTags(raw, "1girl, red hair, school uniform");
  assert.equal(tags.length, 12);
  assert.ok(tags.every((t) => !t.includes("<|") && t.length < 60 && !/^long:/.test(t)));
});
