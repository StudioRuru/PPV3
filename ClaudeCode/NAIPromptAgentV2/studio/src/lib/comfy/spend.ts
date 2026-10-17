import type { Run, ComfySettings } from "./store";

const H = 3_600_000;
export type StopReason = "daily-cap" | "budget" | "idle" | "deadline";

/** Cost of one run to `now` (open runs count to now). */
export function runCost(r: Run, now: number): number {
  return spentSince([r], r.startedAt, now);
}

/** Only the part of each run after `since`. */
export function spentSince(runs: Run[], since: number, now: number): number {
  return runs.reduce((sum, r) => {
    const ms = (r.stoppedAt ?? now) - Math.max(r.startedAt, since);
    return sum + (ms > 0 ? (r.usdHr * ms) / H : 0);
  }, 0);
}

/** Local midnight. */
export function dayStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Why the GPU must stop now, or null. Deadline > budget > daily-cap > idle; a running job defers all but deadline. */
export function stopReason(a: { runs: Run[]; s: ComfySettings; lastActivity: number; keepWarmUntil: number; busy: boolean; deadline: number | null; now: number }): StopReason | null {
  if (a.deadline !== null && a.now >= a.deadline) return "deadline";
  if (a.busy) return null;
  if (spentSince(a.runs, 0, a.now) >= a.s.budgetUsd) return "budget";
  if (spentSince(a.runs, dayStart(a.now), a.now) >= a.s.dailyCapUsd) return "daily-cap";
  if (a.now - a.lastActivity >= a.s.idleMin * 60_000 && a.keepWarmUntil <= a.now) return "idle";
  return null;
}

const usd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function canStart(a: { runs: Run[]; s: ComfySettings; now: number }): { ok: true } | { ok: false; why: string } {
  if (spentSince(a.runs, 0, a.now) >= a.s.budgetUsd)
    return { ok: false, why: `Total GPU budget ($${usd(a.s.budgetUsd)}) reached — ask to raise it.` };
  if (spentSince(a.runs, dayStart(a.now), a.now) >= a.s.dailyCapUsd)
    return { ok: false, why: `Today's GPU cap ($${usd(a.s.dailyCapUsd)}) is used up — raise it in Settings or wait until tomorrow.` };
  return { ok: true };
}

export function clampKeepWarm(until: number, s: ComfySettings, now: number): number {
  return Math.min(until, now + s.keepWarmMaxH * H);
}
