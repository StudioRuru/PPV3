import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOffset, offsetLabel, toOffset } from "./weight";

test("weight ↔ offset: centre (0) is normal / unweighted", () => {
  assert.equal(toOffset(undefined), 0);
  assert.equal(toOffset(1.15), 0.15);
  assert.equal(toOffset(-0.5), -1.5);
  assert.equal(fromOffset(0), undefined);
  assert.equal(fromOffset(0.15), 1.15);
  assert.equal(fromOffset(-2), -1);
  assert.equal(fromOffset(0.1 + 0.2), 1.3, "float noise rounded to 2 dp");
});

test("offsetLabel shows a signed offset, 0 for normal", () => {
  assert.equal(offsetLabel(undefined), "0");
  assert.equal(offsetLabel(1.15), "+0.15");
  assert.equal(offsetLabel(0.8), "−0.20");
});
