import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTags, nearestCorner } from "./ui";

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
