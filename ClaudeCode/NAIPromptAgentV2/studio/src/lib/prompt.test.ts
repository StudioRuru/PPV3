import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, emptyState, newLine, lineToText, parseToLines, splitTags } from "./prompt";

test("weighted line keeps its commas inside one run", () => {
  assert.equal(lineToText(newLine("rain, night", 1.2)), "1.2::rain, night::");
  assert.equal(lineToText(newLine("hat", -1)), "-1::hat::");
  assert.equal(lineToText(newLine("solo", 1)), "solo");
});

test("compile joins enabled lines, skips disabled and empty", () => {
  const s = emptyState();
  s.rating = "off";
  s.base = [newLine("1girl, solo"), { ...newLine("hidden"), enabled: false }, newLine("  "), newLine("smile", 1.15)];
  assert.equal(compile(s).base, "1girl, solo, 1.15::smile::");
});

test("character box with no enabled lines is dropped", () => {
  const s = emptyState();
  s.chars = [
    { id: "a", lines: [newLine("girl, red hair")], uc: "", enabled: true },
    { id: "b", lines: [{ ...newLine("boy"), enabled: false }], uc: "", enabled: true },
    { id: "c", lines: [newLine("girl")], uc: "", enabled: false },
  ];
  assert.deepEqual(compile(s).chars, [{ prompt: "girl, red hair", uc: "", center: undefined }]);
});

test("rating adds tags without duplicating user tags", () => {
  const s = emptyState();
  s.base = [newLine("1girl, nsfw")];
  s.rating = "nsfw";
  assert.equal(compile(s).base, "1girl, nsfw");
  s.rating = "safe";
  s.base = [newLine("1girl")];
  s.uc = "lowres";
  const c = compile(s);
  assert.equal(c.base, "1girl, rating:general");
  assert.equal(c.uc, "lowres, nsfw");
});

test("splitTags and parseToLines round-trip weighted runs", () => {
  assert.deepEqual(splitTags("a, 1.2::b, c::, d"), ["a", "1.2::b, c::", "d"]);
  const lines = parseToLines("1girl, 1.3::rain, night::, smile");
  assert.deepEqual(lines.map((l) => [l.text, l.weight]), [["1girl", undefined], ["rain, night", 1.3], ["smile", undefined]]);
});

test("hasContent ignores rating-only prompts", async () => {
  const { hasContent } = await import("./prompt");
  const s = emptyState();
  s.rating = "nsfw";
  assert.equal(compile(s).base, "nsfw");
  assert.equal(hasContent(s), false);
  s.base = [newLine("1girl")];
  assert.equal(hasContent(s), true);
});
