"use client";
import { useEffect, useState } from "react";
import type { EngineView, StepId } from "@/lib/comfy/engine";
import type { Card } from "@/lib/comfy/store";
import { alarmText, gpuLabel, STEP_LABEL, stepElapsed } from "@/lib/comfy/view";

export type EngineAction = { action: "warm" | "stop" | "flush"; card?: Card } | { action: "boost"; on: boolean } | { action: "keepWarm"; until: number } | { action: "retry"; card: Card; step: StepId };

/** "HH:MM" today (or tomorrow if already past) as epoch ms. The server clamps it to the keep-warm max. */
export function timeToEpoch(hhmm: string, now: number): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime() <= now ? d.getTime() + 86_400_000 : d.getTime();
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);

const isLive = (v: EngineView | null) => !!v && (v.phase === "starting" || v.phase === "warming" || v.phase === "ready");

export function GpuLine({ view, boostView, now, onAction, error }: { view: EngineView | null; boostView: EngineView | null; now: number; onAction: (a: EngineAction) => unknown; error: string | null }) {
  const alarm = view ? alarmText(view) : null;
  const live = isLive(view) || isLive(boostView);
  const showBoost = boostView && boostView.phase !== "off" && boostView.phase !== "unavailable";
  const boost = view?.boost ?? "off";
  const btn = "border-border h-9 rounded-full border px-3 text-xs";
  const [arm, setArm] = useState(false); // flush needs a second tap
  const [seeking, setSeeking] = useState(false); // a restore can wait minutes on Hyperstack
  const seek = () => { setSeeking(true); Promise.resolve(onAction({ action: "warm" })).finally(() => setSeeking(false)); };
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 4000); return () => clearTimeout(t); }, [arm]);
  const canFlush = live || !!view?.kept || !!boostView?.kept;
  const flush = () => {
    if (!arm) return setArm(true);
    setArm(false);
    onAction({ action: "flush" });
    onAction({ action: "flush", card: "boost" });
  };
  return (
    <div className="space-y-2">
      {alarm && <p role="alert" className="bg-danger w-full rounded-lg px-3 py-2 text-sm font-semibold text-white">{alarm}</p>}
      {/* Row 1: what the GPU is doing + H100. Row 2: keep-warm, then the destructive pair (wraps as one group on narrow phones). */}
      <div className="bg-surface border-border space-y-2 rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className="flex-1 font-mono text-xs whitespace-nowrap">{view ? gpuLabel(view, now) : "○ GPU …"}</span>
        {view && (view.phase === "off" || view.phase === "unavailable") && (
          <button type="button" disabled={seeking} onClick={seek} className={`${btn} text-accent disabled:opacity-60`}>{seeking ? "Seeking…" : view.phase === "unavailable" ? "Retry" : "Start"}</button>
        )}
        {showBoost && <span className="font-mono text-xs whitespace-nowrap">{gpuLabel(boostView, now)} · ${boostView.usdHr.toFixed(2)}/h</span>}
        <button type="button" role="switch" aria-checked={boost === "on"} disabled={boost === "unavailable"} onClick={() => onAction({ action: "boost", on: boost !== "on" })}
          className={`${btn} ${boost === "on" ? "bg-accent text-accent-fg border-accent" : "text-muted"} disabled:opacity-50`}>
          {boost === "unavailable" ? "H100 unavailable" : "H100"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted flex items-center gap-1.5 text-xs">Keep warm until
          <input type="time" defaultValue={view && view.keepWarmUntil > now ? hhmm(view.keepWarmUntil) : ""} key={view && view.keepWarmUntil > now ? view.keepWarmUntil : 0}
            onBlur={(e) => { const t = timeToEpoch(e.target.value, Date.now()); if (t && t !== view?.keepWarmUntil) onAction({ action: "keepWarm", until: t }); }}
            className="bg-bg border-border h-9 rounded-md border px-1.5 font-mono text-xs" />
        </label>
        <span className="ml-auto flex gap-2">
        <button type="button" disabled={!live} onClick={() => { onAction({ action: "stop" }); onAction({ action: "stop", card: "boost" }); }} className={`${btn} text-danger disabled:opacity-40`}>Stop now</button>
        <button type="button" disabled={!canFlush} onClick={flush} title="Delete the GPU and its downloaded models; the next start re-downloads them"
          className={`${btn} ${arm ? "bg-danger border-danger text-white" : "text-danger"} disabled:opacity-40`}>{arm ? "Tap again: delete models" : "Flush GPU"}</button>
        </span>
      </div>
      </div>
      {view?.steps && (
        <ul className="bg-surface border-border space-y-1 rounded-lg border px-3 py-2 text-xs" aria-label="GPU launch steps">
          {view.steps.map((st) => (
            <li key={st.id} className="min-w-0">
              <div className="flex items-center gap-2">
                <span aria-hidden className={`w-4 shrink-0 text-center ${st.state === "ok" ? "text-ok" : st.state === "fail" ? "text-danger" : "text-muted"}`}>
                  {st.state === "ok" ? "✓" : st.state === "fail" ? "✕" : st.state === "run" ? <span className="border-accent inline-block size-3 animate-spin rounded-full border-2 border-t-transparent align-middle" /> : "·"}
                </span>
                <span className={`flex-1 ${st.state === "wait" ? "text-muted" : ""}`}>{STEP_LABEL[st.id]}</span>
                <span className="text-muted font-mono tabular-nums">{stepElapsed(st, now)}</span>
              </div>
              {st.state === "ok" && st.note && <p className="text-warn pl-6 break-words">{st.note}</p>}
              {st.state === "fail" && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <p className="text-danger min-w-0 flex-1 break-words">{st.error}</p>
                  <button type="button" onClick={() => onAction({ action: "retry", card: view.card, step: st.id })} className="border-border text-accent h-9 shrink-0 rounded-full border px-3 text-xs">Retry this step</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-danger text-xs">{error}</p>}
    </div>
  );
}
