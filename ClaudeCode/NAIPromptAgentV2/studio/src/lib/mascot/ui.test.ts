import { test } from "node:test";
import assert from "node:assert/strict";
import { composerBottom, diffTags, nearestCorner } from "./ui";

test("diffTags: added and removed, order kept, dupes ignored", () => {
  assert.deepEqual(diffTags(["a", "b", "c"], ["b", "d", "c", "d"]), { added: ["d"], removed: ["a"] });
  assert.deepEqual(diffTags(["a"], ["a"]), { added: [], removed: [] });
  assert.deepEqual(diffTags([], ["x", "y"]), { added: ["x", "y"], removed: [] });
});
test("nearestCorner: picks the viewport quadrant of the point", () => {
  assert.equal(nearestCorner(350, 700, 400, 800), "br");
  assert.equal(nearestCorner(10, 700, 400, 800), "bl");
  assert.equal(nearestCorner(390, 10, 400, 800), "tr");
  assert.equal(nearestCorner(0, 0, 400, 800), "tl");
  assert.equal(nearestCorner(200, 400, 400, 800), "br"); // dead centre stays bottom-right
});
test("composerBottom: tab bar + tallest visible composer + gap; fallback when none", () => {
  const fb = "calc(env(safe-area-inset-bottom) + 8.5rem)";
  assert.equal(composerBottom([]), fb);
  assert.equal(composerBottom([0, 0]), fb); // display:none composers measure 0
  assert.equal(composerBottom([0, 100, 72]), "calc(env(safe-area-inset-bottom) + 3.5rem + 100px + 0.5rem)");
});
