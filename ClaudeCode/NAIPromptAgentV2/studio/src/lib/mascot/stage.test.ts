import { test } from "node:test";
import assert from "node:assert/strict";
import { POSES } from "./poses";
import { EXPRESSIONS } from "./core";
import {
  FLICK_SPEED, TAP_MAX_MOVE, LONGPRESS_MS, POKE_WINDOW_MS, blinkSchedule, chooseSpot, classifyBodyGesture, idleMood,
  nextMoveDelay, wanderStep, onScreen, rectsIntersect, refitSpot, settleSpot, spotBox, type Rect,
} from "./stage";

/** Deterministic, well-mixed mulberry32 in [0,1). */
const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const VW = 390, VH = 844, baseH = 380;
const avoid: Rect[] = [{ x: 0, y: 760, w: 390, h: 84 }, { x: 120, y: 8, w: 150, h: 44 }];
const targets: Rect[] = [{ x: 40, y: 200, w: 310, h: 300 }];
const base = { vw: VW, vh: VH, baseH, avoid, targets };

test("never intersects avoid rects or leaves the screen across many draws", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = seeded(seed);
    const event = [undefined, "idle", "bored", "generate", "typing", "sheet"][seed % 6] as never;
    const s = chooseSpot({ ...base, mischief: seed % 11, event, rand });
    const b = spotBox(s, baseH, VW, VH);
    for (const a of avoid) assert.equal(rectsIntersect(b, a), false, `seed ${seed} ${s.pose}`);
    assert.ok(b.y >= 0 && b.y + b.h <= VH + 0.5, `vertical seed ${seed}`);
    if (s.pose !== "peek") assert.ok(b.x >= -0.5 && b.x + b.w <= VW + 0.5, `horizontal seed ${seed}`);
  }
});

test("draws are varied (guards against vacuous loops) and fit at default baseH", () => {
  const seen = new Set<string>();
  for (let i = 1; i <= 300; i++) seen.add(chooseSpot({ ...base, mischief: 5, event: "idle", rand: seeded(i) }).pose);
  assert.ok(seen.size >= 4, [...seen].join());
  const lies = new Set<string>();
  for (let i = 1; i <= 300; i++) {
    const { baseH: _b, ...noBase } = base; void _b;
    const s = chooseSpot({ ...noBase, mischief: 10, event: "idle", rand: seeded(i) });
    lies.add(s.pose);
    const b = spotBox(s, VH * 0.45, VW, VH);
    for (const a of avoid) assert.equal(rectsIntersect(b, a), false, `default seed ${i} ${s.pose}`);
    assert.ok(b.y >= -0.5 && b.y + b.h <= VH + 0.5);
  }
  assert.ok(lies.has("lie"), [...lies].join());
});

test("typing ducks to the nearest edge as a peek", () => {
  const rand = seeded(3);
  const l = chooseSpot({ ...base, mischief: 8, event: "typing", rand, from: { x: 60, y: 600 } });
  assert.equal(l.pose, "peek"); assert.ok(l.x < VW / 2); assert.equal(l.flip, false);
  const r = chooseSpot({ ...base, mischief: 8, event: "typing", rand, from: { x: 340, y: 600 } });
  assert.equal(r.pose, "peek"); assert.ok(r.x > VW / 2); assert.equal(r.flip, true);
});

test("sheet opening peeks", () => {
  assert.equal(chooseSpot({ ...base, mischief: 5, event: "sheet", rand: seeded(9) }).pose, "peek");
});

test("generate shows her back facing the nearest target", () => {
  const s = chooseSpot({ ...base, mischief: 5, event: "generate", rand: seeded(5) });
  assert.equal(s.pose, "back");
  const tc = targets[0].x + targets[0].w / 2;
  assert.equal(s.flip, tc < s.x);
  // no targets -> faces centre
  const n = chooseSpot({ ...base, targets: [], mischief: 5, event: "generate", rand: seeded(5) });
  assert.equal(n.pose, "back"); assert.equal(n.flip, VW / 2 < n.x);
});

test("bored favours legs", () => {
  let legs = 0;
  for (let i = 1; i <= 100; i++) if (chooseSpot({ ...base, mischief: 5, event: "bored", rand: seeded(i) }).pose === "legs") legs++;
  assert.ok(legs >= 50, `legs ${legs}`);
});

test("mischief 0 parks at an edge and never auto-moves", () => {
  assert.equal(nextMoveDelay(0, seeded(1)), Infinity);
  const seen0 = new Set<string>();
  for (let i = 1; i <= 100; i++) {
    const s = chooseSpot({ ...base, mischief: 0, event: "idle", rand: seeded(i) });
    assert.ok(s.pose === "stand" || s.pose === "peek", `pose ${s.pose}`);
    seen0.add(s.pose);
    const b = spotBox(s, baseH, VW, VH);
    assert.ok(b.x <= 1 || b.x + b.w >= VW - 1, `edge ${i}`);
  }
});

test("higher mischief is more central and more varied; apose stays rare", () => {
  const stat = (m: number) => {
    let cx = 0, rare = 0, lazy = 0; const varied = new Set<string>();
    for (let i = 1; i <= 200; i++) {
      const s = chooseSpot({ ...base, mischief: m, event: "idle", rand: seeded(i) });
      cx += Math.abs(s.x - VW / 2); varied.add(s.pose); if (s.pose === "apose") rare++; if (s.pose === "lie" || s.pose === "sit" || s.pose === "legs") lazy++;
    }
    return { cx: cx / 200, rare, lazy, n: varied.size };
  };
  const lo = stat(1), hi = stat(10);
  assert.ok(hi.cx < lo.cx, `${hi.cx} < ${lo.cx}`);
  assert.ok(hi.lazy > lo.lazy, JSON.stringify({ lo, hi }));
  assert.ok(hi.rare < 40);
});

test("no fitting candidate falls back to an edge peek", () => {
  const wall: Rect[] = [{ x: 200, y: 0, w: 100, h: VH }];
  const s = chooseSpot({ ...base, avoid: wall, mischief: 10, event: "idle", rand: seeded(2) });
  assert.equal(s.pose, "peek");
  assert.equal(rectsIntersect(spotBox(s, baseH, VW, VH), wall[0]), false);
});

test("spotBox sizes follow POSE_SPEC aspect", () => {
  const stand = spotBox({ pose: "stand", x: 195, y: 844, flip: false, scale: 1 }, 400, VW, VH);
  assert.ok(Math.abs(stand.w / stand.h - 832 / 1216) < 1e-6); assert.equal(stand.h, 400);
  const lie = spotBox({ pose: "lie", x: 195, y: 844, flip: false, scale: 1 }, 400, VW, VH);
  assert.ok(lie.w > lie.h);
});

test("nextMoveDelay is 20-90s scaled by mischief, deterministic", () => {
  for (const m of [1, 5, 10]) for (const r of [0, 0.5, 0.999]) {
    const d = nextMoveDelay(m, () => r);
    assert.ok(d >= 10_000 && d <= 135_000, `${m} ${r} ${d}`);
  }
  assert.equal(nextMoveDelay(5, () => 0), 20_000);
  assert.ok(nextMoveDelay(10, () => 0.5) < nextMoveDelay(1, () => 0.5));
});

test("blink and mood helpers", () => {
  const b = blinkSchedule(seeded(1)); assert.ok(b >= 2000 && b <= 7000);
  for (let i = 1; i < 50; i++) assert.ok((EXPRESSIONS as readonly string[]).includes(idleMood(seeded(i), false)));
  assert.equal(idleMood(() => 0, true), "sleepy");
  assert.ok(POSES.length > 0);
});

// --- gestures ---
const box: Rect = { x: 100, y: 300, w: 200, h: 400 };
type S = { x: number; y: number; t: number }[];
const still = (x: number, y: number, ms: number): S => [{ x, y, t: 1000 }, { x, y, t: 1000 + ms }];
/** Horizontal move of dx px over ms, with the last 40ms covering `lastDx`. */
const sweep = (dx: number, ms: number, x0 = 200, y0 = 500): S => [
  { x: x0, y: y0, t: 1000 }, { x: x0 + dx * 0.5, y: y0, t: 1000 + ms - 40 }, { x: x0 + dx, y: y0, t: 1000 + ms },
];
const table: [string, S, number | null, string | null][] = [
  ["empty", [], null, null],
  ["single sample = instant tap", [{ x: 200, y: 500, t: 5 }], null, "menu"],
  ["tap body, no prior -> menu", still(200, 500, 100), null, "menu"],
  ["tap body, prior tap long ago -> menu", still(200, 500, 100), 1100 - POKE_WINDOW_MS - 1, "menu"],
  ["tap top 20% -> pat", still(200, 310, 100), null, "pat"],
  ["pat beats poke", still(200, 310, 100), 1050, "pat"],
  ["rapid second tap -> poke", still(200, 500, 100), 1100 - 800, "poke"],
  ["hold 500ms still -> longpress", still(200, 500, LONGPRESS_MS), null, "longpress"],
  ["hold just short -> tap", still(200, 500, LONGPRESS_MS - 1), null, "menu"],
  ["jitter within tap radius still tap", [{ x: 200, y: 500, t: 1000 }, { x: 200 + TAP_MAX_MOVE, y: 500, t: 1100 }], null, "menu"],
  ["slow drag", sweep(60, 800), null, "drag"],
  ["slow long hold-drag", [0, 1, 2, 3].map((i) => ({ x: 200 + 50 * i, y: 500, t: 1000 + 1000 * i })), null, "drag"],
  ["fast flick stays on-screen -> flick", sweep(68, 100, 40), null, "flick"],
  ["fast flick toward edge lands off-screen -> swipeOff", sweep(100, 60, 330), null, "swipeOff"],
  ["fast flick left off-screen -> swipeOff", sweep(-100, 60, 60), null, "swipeOff"],
  ["fast flick up off-screen -> swipeOff", [{ x: 200, y: 60, t: 1000 }, { x: 200, y: 30, t: 1040 }, { x: 200, y: 10, t: 1060 }], null, "swipeOff"],
  ["just below flick speed -> drag", sweep(FLICK_SPEED * 80 * 0.9, 400), null, "drag"],
];
for (const [name, samples, lastTapAt, want] of table)
  test(`gesture: ${name}`, () => {
    assert.equal(classifyBodyGesture(samples, { box, vw: VW, vh: VH, lastTapAt }), want);
  });

test("onScreen keeps rects that are non-empty and inside the viewport", () => {
  const rs: Rect[] = [{ x: 0, y: 760, w: 390, h: 84 }, { x: 0, y: 0, w: 0, h: 0 }, { x: 10, y: 900, w: 50, h: 50 }, { x: -60, y: 10, w: 50, h: 50 }, { x: -10, y: -10, w: 50, h: 50 }];
  assert.deepEqual(onScreen(rs, VW, VH), [rs[0], rs[4]]);
});

test("settleSpot lands near the drop, on-screen, clear of avoid; picks a fitting pose", () => {
  const all = () => true, ctx = { ...base, rand: seeded(3) };
  const s = settleSpot({ x: 200, y: 600 }, ctx, all);
  assert.equal(s.pose, "stand");
  assert.ok(Math.abs(s.x - 200) < 1 && Math.abs(s.y - 600) <= 200);
  const floor = settleSpot({ x: 200, y: 830 }, ctx, all);
  assert.equal(floor.pose, "lie", "dropped low: lies down");
  const card = settleSpot({ x: 200, y: 510 }, { ...ctx, targets: [{ x: 40, y: 500, w: 310, h: 200 }] }, all);
  assert.equal(card.pose, "sit", "dropped on a card's top edge: sits on it");
  assert.equal(card.y, 500);
  assert.equal(settleSpot({ x: 200, y: 830 }, ctx, (p) => p === "stand").pose, "stand", "only renderable poses");
  for (const d of [{ x: -50, y: 830 }, { x: 500, y: 100 }, { x: 195, y: 790 }, { x: 0, y: 0 }]) {
    const t = settleSpot(d, ctx, all), b = spotBox(t, baseH, VW, VH);
    for (const a of avoid) assert.equal(rectsIntersect(b, a), false, JSON.stringify(d));
    assert.ok(b.y >= -0.5 && b.y + b.h <= VH + 0.5 && (t.pose === "peek" || (b.x >= -0.5 && b.x + b.w <= VW + 0.5)), JSON.stringify(d));
  }
});

test("refitSpot: resize keeps her spot, nudges her back on-screen, null only when she'd cover an avoid rect", () => {
  const s = { pose: "stand" as const, x: 200, y: 600, flip: false, scale: 1 };
  assert.equal(refitSpot(s, baseH, VW, VH, avoid), s, "still fine: same object, no move");
  assert.deepEqual(refitSpot({ ...s, y: 700 }, baseH, VW, 650, []), { ...s, y: 650 }, "toolbar shrank the viewport: feet nudged up");
  assert.deepEqual(refitSpot({ ...s, x: 380 }, baseH, VW, VH, []), { ...s, x: VW - 130 }, "narrower: nudged in");
  const peek = { pose: "peek" as const, x: 30, y: 700, flip: false, scale: 1 };
  assert.equal(refitSpot(peek, baseH, VW, VH, []), peek, "peek keeps its off-edge x");
  assert.equal(refitSpot({ ...s, y: 800 }, baseH, VW, VH, avoid), null, "over the composer: re-pick");
});

test("wanderStep waits out a render, then rests a full delay before moving", () => {
  assert.equal(wanderStep(true, false), "wait");
  assert.equal(wanderStep(true, true), "wait");
  assert.equal(wanderStep(false, true), "rest"); // just finished thinking: let her wave first
  assert.equal(wanderStep(false, false), "move");
});
