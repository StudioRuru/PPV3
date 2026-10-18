"use client";
import { useEffect, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import type { Card } from "@/lib/comfy/store";
import { alarmText, gpuLabel } from "@/lib/comfy/view";

export type EngineAction = { action: "warm" | "stop" | "flush"; card?: Card } | { action: "boost"; on: boolean } | { action: "keepWarm"; until: number };

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
      <div className="bg-surface border-border flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <span role="status" className="flex-1 font-mono text-xs whitespace-nowrap">{view ? gpuLabel(view, now) : "○ GPU …"}</span>
        {view && (view.phase === "off" || view.phase === "unavailable") && (
          <button type="button" disabled={seeking} onClick={seek} className={`${btn} text-accent disabled:opacity-60`}>{seeking ? "Seeking…" : view.phase === "unavailable" ? "Retry" : "Start"}</button>
        )}
        {showBoost && <span className="font-mono text-xs whitespace-nowrap">{gpuLabel(boostView, now)} · ${boostView.usdHr.toFixed(2)}/h</span>}
        <button type="button" role="switch" aria-checked={boost === "on"} disabled={boost === "unavailable"} onClick={() => onAction({ action: "boost", on: boost !== "on" })}
          className={`${btn} ${boost === "on" ? "bg-accent text-accent-fg border-accent" : "text-muted"} disabled:opacity-50`}>
          {boost === "unavailable" ? "H100 unavailable" : "H100"}
        </button>
        <label className="text-muted flex items-center gap-1.5 text-xs">keep warm until
          <input type="time" defaultValue={view && view.keepWarmUntil > now ? hhmm(view.keepWarmUntil) : ""} key={view && view.keepWarmUntil > now ? view.keepWarmUntil : 0}
            onBlur={(e) => { const t = timeToEpoch(e.target.value, Date.now()); if (t && t !== view?.keepWarmUntil) onAction({ action: "keepWarm", until: t }); }}
            className="bg-bg border-border h-9 rounded-md border px-1.5 font-mono text-xs" />
        </label>
        <button type="button" disabled={!live} onClick={() => { onAction({ action: "stop" }); onAction({ action: "stop", card: "boost" }); }} className={`${btn} text-danger disabled:opacity-40`}>Stop now</button>
        <button type="button" disabled={!canFlush} onClick={flush} title="Delete the GPU and its downloaded models; the next start re-downloads them"
          className={`${btn} ${arm ? "bg-danger border-danger text-white" : "text-danger"} disabled:opacity-40`}>{arm ? "Tap again: delete models" : "Flush GPU"}</button>
      </div>
      {error && <p role="alert" className="text-danger text-xs">{error}</p>}
    </div>
  );
}
