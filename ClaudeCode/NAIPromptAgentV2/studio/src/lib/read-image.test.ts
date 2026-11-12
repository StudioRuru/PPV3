import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRead, toLines } from "./read-image";

test("parseRead + toLines split known tags from optional phrases", () => {
  const r = parseRead('```json\n{"base":["2girls","Beach"],"characters":[["long_hair","black peplum top","heart-shaped earrings","long hair"],[]]}\n```');
  assert.deepEqual(r, { base: ["2girls", "beach"], characters: [["long hair", "black peplum top", "heart-shaped earrings", "long hair"]] });
  const lines = toLines(r.characters[0], new Set(["long hair", "black peplum top"]));
  assert.equal(lines[0].text, "long hair, black peplum top");
  assert.equal(lines[0].enabled, true);
  assert.deepEqual(lines.slice(1).map((l) => [l.text, l.enabled, l.optional]), [["heart-shaped earrings", false, true]]);
  assert.deepEqual(parseRead('{"characters":[["red eyes, fox ears"]]}').characters, [["red eyes", "fox ears"]]);
  assert.throws(() => parseRead("no json here"));
});
