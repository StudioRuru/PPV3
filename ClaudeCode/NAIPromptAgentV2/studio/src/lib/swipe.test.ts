import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeDirection } from "./swipe";

test("swipeDirection: a quick, mostly-horizontal swipe switches tabs; scrolls and slow drags don't", () => {
  assert.equal(swipeDirection({ dx: -80, dy: 10, ms: 200 }), "next");
  assert.equal(swipeDirection({ dx: 90, dy: -20, ms: 300 }), "prev");
  assert.equal(swipeDirection({ dx: -40, dy: 0, ms: 150 }), null, "too short");
  assert.equal(swipeDirection({ dx: -80, dy: 60, ms: 200 }), null, "too diagonal (vertical scroll)");
  assert.equal(swipeDirection({ dx: -120, dy: 0, ms: 900 }), null, "too slow (a drag, not a swipe)");
});
