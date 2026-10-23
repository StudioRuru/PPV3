"use client";
import { useEffect, useRef } from "react";
import { restoreTake } from "@/lib/comfy/reuse";
import type { Item } from "@/lib/comfy/store";

const HOLD_MS = 250;

/** Vertical history of photo takes, newest on top. Click restores; hold (250 ms) or hold Space compares. */
export function TakeStrip({ takes, current, onRestore, onCompare }: { takes: Item[]; current: string | null; onRestore: (it: Item) => void; onCompare: (file: string | null) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cmp = useRef(onCompare);
  cmp.current = onCompare;
  // Unmount (e.g. window shrinks below the breakpoint mid-hold): never leave a compare running.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); cmp.current(null); }, []);
  const start = (file: string) => { held.current = false; timer.current = setTimeout(() => { held.current = true; onCompare(file); }, HOLD_MS); };
  const end = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; if (held.current) onCompare(null); };
  const abort = () => { end(); held.current = false; }; // leave/cancel: no click follows, so don't swallow the next one
  return (
    <div role="list" aria-label="Takes" className="flex h-full flex-col gap-2 overflow-y-auto">
      {takes.length === 0 && <p className="text-faint px-1 text-center text-[11px]">No takes yet</p>}
      {takes.map((t) => {
        const gone = restoreTake(t) === null;
        return (
          <button key={t.id} role="listitem" type="button" aria-label={`Take ${t.id}`} aria-current={t.file === current} title={gone ? "Imported: can't restore" : undefined}
            onPointerDown={() => start(t.file)} onPointerUp={end} onPointerLeave={abort} onPointerCancel={abort}
            onClick={() => { if (held.current) { held.current = false; return; } if (!gone) onRestore(t); }}
            onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); if (!e.repeat) onCompare(t.file); } }}
            onKeyUp={(e) => { if (e.key === " ") { e.preventDefault(); onCompare(null); } }}
            onBlur={() => onCompare(null)}
            className={`bg-surface w-full shrink-0 overflow-hidden rounded border-2 ${gone ? "opacity-50" : ""} ${t.file === current ? "border-accent" : "border-border"}`}>
            <img src={`/api/comfy/file/${t.file}`} alt="" draggable={false} className="aspect-square w-full object-cover" />
          </button>
        );
      })}
    </div>
  );
}
