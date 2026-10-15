import { test } from "node:test";
import assert from "node:assert/strict";
import { ANCHOR, anchorBox, CAL_ZERO, classifyIslandGesture, contentVisible, dragAmount, dragSize, drawerSize, EXPANDED, hasIsland, mergeCalibration, nextState, springEasing, swipeTab } from "./island";

test("nextState: tap minimal→compact→expanded→compact; expand/collapse/peek/timeout", () => {
  assert.equal(nextState("minimal", "tap"), "compact");
  assert.equal(nextState("compact", "tap"), "expanded");
  assert.equal(nextState("expanded", "tap"), "compact");
  for (const s of ["minimal", "compact", "expanded"] as const) {
    assert.equal(nextState(s, "expand"), "expanded");
    assert.equal(nextState(s, "collapse"), "minimal");
  }
  assert.equal(nextState("minimal", "peek"), "compact");
  assert.equal(nextState("expanded", "peek"), "expanded", "peek never shrinks an open drawer");
  assert.equal(nextState("compact", "timeout"), "minimal");
  assert.equal(nextState("expanded", "timeout"), "expanded");
});

test("classifyIslandGesture: tap, long-press, swipes, drag down/up with the sample's factors", () => {
  assert.equal(classifyIslandGesture({ dx: 3, dy: -4, ms: 120 }), "tap");
  assert.equal(classifyIslandGesture({ dx: 6, dy: 6, ms: 600 }), "longpress");
  assert.equal(classifyIslandGesture({ dx: -60, dy: 10, ms: 200 }), "swipeLeft");
  assert.equal(classifyIslandGesture({ dx: 60, dy: -20, ms: 200 }), "swipeRight");
  assert.equal(classifyIslandGesture({ dx: 45, dy: 35, ms: 200 }), null, "diagonal: neither swipe nor enough drag");
  assert.equal(classifyIslandGesture({ dx: 0, dy: 90, ms: 300 }), "down", "90×0.65 = 58.5 > 55");
  assert.equal(classifyIslandGesture({ dx: 0, dy: 80, ms: 300 }), null, "80×0.65 = 52 < 55 springs back");
  assert.equal(classifyIslandGesture({ dx: 0, dy: -80, ms: 300 }), "up", "−80×0.4 = −32 < −30");
  assert.equal(classifyIslandGesture({ dx: 0, dy: -70, ms: 300 }), null);
  assert.equal(dragAmount(100), 65);
  assert.equal(dragAmount(-100), -40);
});

test("swipeTab: left → next, right → previous, stops at the ends", () => {
  const tabs = ["a", "b", "c"];
  assert.equal(swipeTab(tabs, "b", "swipeLeft"), "c");
  assert.equal(swipeTab(tabs, "b", "swipeRight"), "a");
  assert.equal(swipeTab(tabs, "c", "swipeLeft"), null);
  assert.equal(swipeTab(tabs, "a", "swipeRight"), null);
});

test("anchorBox + drawerSize: sample defaults, calibration offsets, plain pill without an island", () => {
  const a = anchorBox(CAL_ZERO, true, 59);
  assert.deepEqual(a, { x: 0, top: ANCHOR.top, w: ANCHOR.w, h: ANCHOR.h });
  assert.deepEqual(anchorBox({ x: 2, y: -1, w: 4, h: 1 }, true, 59), { x: 2, top: 10, w: 130, h: ANCHOR.h + 1 });
  const pill = anchorBox({ x: 9, y: 9, w: 9, h: 9 }, false, 20);
  assert.equal(pill.x, 0, "calibration ignored without an island");
  assert.ok(pill.top > 20 && pill.w < ANCHOR.w);
  assert.deepEqual(drawerSize("minimal", a, 393), { w: a.w, h: a.h });
  const c = drawerSize("compact", a, 393);
  assert.ok(c.w > a.w && c.h > a.h && c.h < EXPANDED.h);
  assert.deepEqual(drawerSize("expanded", a, 393), EXPANDED);
  assert.equal(drawerSize("expanded", a, 320).w, 304, "never wider than the viewport minus 16");
});

test("dragSize: grows w +1.6×, h +0.9× of the drag, clamped between the anchor and the expanded drawer", () => {
  const a = { w: 126, h: 37.33 }, max = EXPANDED;
  assert.deepEqual(dragSize(a, a, max, 50), { w: 206, h: 37.33 + 45 });
  assert.deepEqual(dragSize(a, a, max, 1000), max);
  assert.deepEqual(dragSize(max, a, max, -40), { w: 340 - 64, h: 150 - 36 });
  assert.deepEqual(dragSize(max, a, max, -1000), a);
  assert.equal(contentVisible("expanded", 0), true);
  assert.equal(contentVisible("minimal", 41), true);
  assert.equal(contentVisible("compact", 40), false);
});

test("hasIsland: top inset ≥ 50", () => {
  assert.equal(hasIsland(59), true);
  assert.equal(hasIsland(50), true);
  assert.equal(hasIsland(47), false);
  assert.equal(hasIsland(0), false);
});

test("mergeCalibration: bounded numeric offsets, invalid fields ignored, zeros reset", () => {
  assert.deepEqual(mergeCalibration(CAL_ZERO, { x: -40, y: 40, w: 60, h: -40 }), { x: -40, y: 40, w: 60, h: -40 });
  assert.deepEqual(mergeCalibration(CAL_ZERO, { x: 41, y: "3", w: -41, h: NaN }), CAL_ZERO);
  assert.deepEqual(mergeCalibration({ x: 5, y: 5, w: 5, h: 5 }, { w: 1.5 }), { x: 5, y: 5, w: 1.5, h: 5 });
  assert.deepEqual(mergeCalibration({ x: 5, y: 5, w: 5, h: 5 }, CAL_ZERO), CAL_ZERO);
  assert.deepEqual(mergeCalibration(CAL_ZERO, null), CAL_ZERO);
});

test("springEasing: linear() from 0 to 1 with a small overshoot, settles in ~0.5 s", () => {
  const { easing, ms } = springEasing();
  const pts = easing.slice(7, -1).split(", ").map(Number);
  assert.match(easing, /^linear\(/);
  assert.equal(pts[0], 0);
  assert.equal(pts.at(-1), 1);
  assert.ok(Math.max(...pts) > 1 && Math.max(...pts) < 1.1, "underdamped (0.72): slight overshoot");
  assert.ok(ms > 400 && ms < 700, String(ms));
});
