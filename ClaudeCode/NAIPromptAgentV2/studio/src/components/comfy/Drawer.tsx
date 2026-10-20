"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/net";

export type JobView = { status: "queued" | "running" | "done" | "error"; progress: number; error: string | null; itemId: number | null; result?: { image: string; keypoints: unknown } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns `poll(id, tick?)`: checks a job every second until it is done/error, gives up after 5 network failures, and stops (as "Cancelled.") when the component unmounts. Also returns `alive` for callers to guard state updates. */
export function useJob() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const poll = async (id: number, tick?: (j: JobView) => void): Promise<JobView> => {
    let fails = 0;
    for (;;) {
      const res = await requestJson<JobView>(`/api/comfy/jobs/${id}`);
      if (!alive.current) return { status: "error", progress: 0, error: "Cancelled.", itemId: null };
      if (!res.ok) { if (++fails > 5) return { status: "error", progress: 0, error: res.error, itemId: null }; }
      else {
        fails = 0;
        tick?.(res.data);
        if (res.data.status === "done" || res.data.status === "error") return res.data;
      }
      await sleep(1000);
    }
  };
  return { poll, alive };
}

/** Bottom sheet for the Comfy tabs: drag the handle up/down (or tap it) to open/close; prompt, tool slot, primary button, progress. */
export function Drawer({ prompt, onPrompt, placeholder, children, action, onAction, disabled, progress, note, open: openProp, onOpenChange }: {
  prompt: string; onPrompt: (v: string) => void; placeholder: string; children?: React.ReactNode;
  action: string; onAction: () => void; disabled?: boolean; progress?: number | null; note?: React.ReactNode;
  /** Optional control from the parent (chips open the drawer); otherwise it manages itself. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = (v: boolean) => { setOwn(v); onOpenChange?.(v); };
  const drag = useRef<number | null>(null);
  return (
    <div data-noswipe className="bg-surface border-border fixed inset-x-0 bottom-0 z-20 mx-auto max-w-6xl rounded-t-2xl border-t"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
      <button type="button" aria-label={open ? "Collapse drawer" : "Expand drawer"} aria-expanded={open} style={{ touchAction: "none" }}
        onPointerDown={(e) => { drag.current = e.clientY; }}
        onPointerUp={(e) => {
          const dy = drag.current === null ? 0 : e.clientY - drag.current;
          drag.current = null;
          setOpen(Math.abs(dy) < 8 ? !open : dy < 0);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onClick={(e) => { if (e.detail === 0) setOpen(!open); }} // keyboard / assistive tech (pointer taps are handled on pointerup)
        className="grid h-7 w-full place-items-center">
        <span className="bg-border h-1 w-10 rounded-full" />
      </button>
      <div className="space-y-3 px-3">
        <textarea value={prompt} onChange={(e) => onPrompt(e.target.value)} placeholder={placeholder} rows={open ? 4 : 2} aria-label="Prompt"
          className="bg-bg border-border w-full resize-none rounded-md border px-3 py-2 text-base" />
        {open && <div className="max-h-[45dvh] overflow-y-auto overscroll-contain">{children}</div>} {/* tall tools (Tune) scroll here so the handle stays on screen */}
        {note && <p role="status" className="text-muted text-center font-mono text-xs">{note}</p>}
        {progress != null && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="bg-bg h-1.5 overflow-hidden rounded-full">
            <div className="bg-accent h-full" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <button type="button" onClick={onAction} disabled={disabled}
          className="bg-accent text-accent-fg w-full rounded-lg px-6 py-3 text-base font-semibold disabled:opacity-50">{action}</button>
      </div>
    </div>
  );
}
