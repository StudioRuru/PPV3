import { test } from "node:test";
import assert from "node:assert/strict";
import { safeGalleryName } from "./gallery";

test("gallery names reject traversal and non-png", () => {
  assert.equal(safeGalleryName("20261013-120000-42.png"), "20261013-120000-42.png");
  assert.equal(safeGalleryName("../studio.db"), null);
  assert.equal(safeGalleryName("..%2Fstudio.db"), null);
  assert.equal(safeGalleryName("a/b.png"), null);
  assert.equal(safeGalleryName("x.txt"), null);
});
