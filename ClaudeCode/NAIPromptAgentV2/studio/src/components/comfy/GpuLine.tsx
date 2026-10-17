"use client";
import type { EngineView } from "@/lib/comfy/engine";
import { alarmText, gpuLabel } from "@/lib/comfy/view";

export type EngineAction = { action: "warm" | "stop" } | { action: "boost"; on: boolean } | { action: "keepWarm"; until: number };

/** "HH:MM" today (or tomorrow if already past) as epoch ms. The server clamps it to the keep-warm max. */
export function timeToEpoch(hhmm: string, now: number): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime() <= now ? d.getTime() + 86_400_000 : d.getTime();
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);

export function GpuLine({ view, now, onAction, error }: { view: EngineView | null; now: number; onAction: (a: EngineAction) => void; error: string | null }) {
  const alarm = view ? alarmText(view) : null;
  const live = view && (view.phase === "starting" || view.phase === "warming" || view.phase === "ready");
  const boost = view?.boost ?? "off";
  const btn = "border-border h-9 rounded-full border px-3 text-xs";
  return (
    <div className="space-y-2">
      {alarm && <p role="alert" className="bg-danger w-full rounded-lg px-3 py-2 text-sm font-semibold text-white">{alarm}</p>}
      <div className="bg-surface border-border flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <span role="status" className="flex-1 font-mono text-xs whitespace-nowrap">{view ? gpuLabel(view, now) : "○ GPU …"}</span>
        <button type="button" role="switch" aria-checked={boost === "on"} disabled={boost === "unavailable"} onClick={() => onAction({ action: "boost", on: boost !== "on" })}
          className={`${btn} ${boost === "on" ? "bg-accent text-accent-fg border-accent" : "text-muted"} disabled:opacity-50`}>
          {boost === "unavailable" ? "H100 unavailable" : "H100"}
        </button>
        <label className="text-muted flex items-center gap-1.5 text-xs">keep warm until
          <input type="time" defaultValue={view && view.keepWarmUntil > now ? hhmm(view.keepWarmUntil) : ""} key={view && view.keepWarmUntil > now ? view.keepWarmUntil : 0}
            onBlur={(e) => { const t = timeToEpoch(e.target.value, Date.now()); if (t && t !== view?.keepWarmUntil) onAction({ action: "keepWarm", until: t }); }}
            className="bg-bg border-border h-9 rounded-md border px-1.5 font-mono text-xs" />
        </label>
        <button type="button" disabled={!live} onClick={() => onAction({ action: "stop" })} className={`${btn} text-danger disabled:opacity-40`}>Stop now</button>
      </div>
      {error && <p role="alert" className="text-danger text-xs">{error}</p>}
    </div>
  );
}
