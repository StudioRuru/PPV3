import { test } from "node:test";
import assert from "node:assert/strict";
import { atBottom, loreCount, swipeAxis, swipeTarget } from "./chat-ui";

test("swipeAxis locks only after slop, diagonal is vertical", () => {
  assert.equal(swipeAxis(4, 1), null);
  assert.equal(swipeAxis(14, 3), "x");
  assert.equal(swipeAxis(12, 10), "y");
  assert.equal(swipeAxis(2, 15), "y");
  assert.equal(swipeAxis(-20, 5), "x");
});

test("swipeTarget steps, regenerates past the end, ignores while busy", () => {
  assert.equal(swipeTarget({ index: 1, count: 3, dir: 1, busy: false }), 2);
  assert.equal(swipeTarget({ index: 0, count: 3, dir: -1, busy: false }), null);
  assert.equal(swipeTarget({ index: 2, count: 3, dir: 1, busy: false }), "regenerate");
  assert.equal(swipeTarget({ index: 2, count: 3, dir: 1, busy: true }), null);
});

test("atBottom within 120px slack", () => {
  assert.equal(atBottom(800, 1080, 2000), true);
  assert.equal(atBottom(800, 1000, 2000), false);
});

test("loreCount counts distinct ids", () => {
  assert.equal(loreCount([3, null, 3, 7]), 2);
  assert.equal(loreCount([]), 0);
});
