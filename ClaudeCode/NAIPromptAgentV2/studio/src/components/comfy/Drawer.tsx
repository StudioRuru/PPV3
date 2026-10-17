"use client";
import { useRef, useState } from "react";

/** Bottom sheet for the Comfy tabs: drag the handle up/down (or tap it) to open/close; prompt, tool slot, primary button, progress. */
export function Drawer({ prompt, onPrompt, placeholder, children, action, onAction, disabled, progress }: {
  prompt: string; onPrompt: (v: string) => void; placeholder: string; children?: React.ReactNode;
  action: string; onAction: () => void; disabled?: boolean; progress?: number | null;
}) {
  const [open, setOpen] = useState(false);
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
        {open && <div>{children}</div>}
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
