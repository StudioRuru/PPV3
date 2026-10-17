import { test } from "node:test";
import assert from "node:assert/strict";
import { runCost, spentSince, dayStart, stopReason, canStart, clampKeepWarm } from "./spend";
import type { Run, ComfySettings } from "./store";

const H = 3_600_000;
const s: ComfySettings = { dailyCapUsd: 10, keepWarmMaxH: 6, idleMin: 50, budgetUsd: 20 };
const run = (startedAt: number, stoppedAt: number | null, usdHr = 1): Run =>
  ({ id: 1, card: "main", vmId: "v", usdHr, startedAt, stoppedAt, stopReason: null });

test("cost of an open run counts to now", () => {
  assert.equal(runCost(run(0, null, 0.9), 2 * H), 1.8);
  assert.equal(runCost(run(0, H, 2), 5 * H), 2);
});

test("daily spend splits a run crossing midnight", () => {
  const start = new Date(2026, 5, 10, 22).getTime();
  const end = new Date(2026, 5, 11, 2).getTime();
  const midnight = new Date(2026, 5, 11).getTime();
  assert.equal(dayStart(end), midnight);
  assert.ok(Math.abs(spentSince([run(start, end, 1)], midnight, end) - 2) < 1e-9);
});

test("idle fires after idleMin unless keep-warm is in the future", () => {
  const now = 10 * H;
  const base = { runs: [], s, busy: false, deadline: null, now };
  const idle = now - 50 * 60_000;
  assert.equal(stopReason({ ...base, lastActivity: idle, keepWarmUntil: 0 }), "idle");
  assert.equal(stopReason({ ...base, lastActivity: idle + 1, keepWarmUntil: 0 }), null);
  assert.equal(stopReason({ ...base, lastActivity: idle, keepWarmUntil: now + 1 }), null);
});

test("busy suppresses caps and idle but not deadline", () => {
  const now = 10 * H;
  const a = { runs: [run(0, null, 5)], s, lastActivity: 0, keepWarmUntil: 0, busy: true, deadline: null, now };
  assert.equal(stopReason(a), null);
  assert.equal(stopReason({ ...a, busy: false }), "budget");
  assert.equal(stopReason({ ...a, deadline: now }), "deadline");
});

test("daily cap stops when today's spend reaches it", () => {
  const now = new Date(2026, 5, 10, 12).getTime();
  const r = run(now - 11 * H, null, 1); // 11 $ today, budget 20 not hit
  assert.equal(stopReason({ runs: [r], s, lastActivity: now, keepWarmUntil: 0, busy: false, deadline: null, now }), "daily-cap");
});

test("canStart refuses at the cap and at the budget", () => {
  const now = new Date(2026, 5, 10, 12).getTime();
  assert.deepEqual(canStart({ runs: [], s, now }), { ok: true });
  assert.deepEqual(canStart({ runs: [run(now - 10 * H, now)], s, now }),
    { ok: false, why: "Today's GPU cap ($10) is used up — raise it in Settings or wait until tomorrow." });
  const old = new Date(2026, 4, 1).getTime();
  assert.deepEqual(canStart({ runs: [run(old, old + 20 * H)], s, now }),
    { ok: false, why: "Total GPU budget ($20) reached — ask to raise it." });
});

test("keep-warm clamps to 6 h", () => {
  assert.equal(clampKeepWarm(100 * H, s, 0), 6 * H);
  assert.equal(clampKeepWarm(2 * H, s, 0), 2 * H);
});
