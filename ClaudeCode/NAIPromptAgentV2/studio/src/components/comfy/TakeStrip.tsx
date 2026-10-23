"use client";
import { useRef } from "react";
import type { Item } from "@/lib/comfy/store";

const HOLD_MS = 250;

/** Vertical history of photo takes, newest on top. Click restores; hold (250 ms) or hold Space compares. */
export function TakeStrip({ takes, current, onRestore, onCompare }: { takes: Item[]; current: string | null; onRestore: (it: Item) => void; onCompare: (file: string | null) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = (file: string) => { held.current = false; timer.current = setTimeout(() => { held.current = true; onCompare(file); }, HOLD_MS); };
  const end = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; if (held.current) onCompare(null); };
  return (
    <div role="list" aria-label="Takes" className="flex h-full flex-col gap-2 overflow-y-auto">
      {takes.length === 0 && <p className="text-faint px-1 text-center text-[11px]">No takes yet</p>}
      {takes.map((t) => (
        <button key={t.id} role="listitem" type="button" aria-label={`Take ${t.id}`} aria-current={t.file === current}
          onPointerDown={() => start(t.file)} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
          onClick={() => { if (held.current) { held.current = false; return; } onRestore(t); }}
          onKeyDown={(e) => { if (e.key === " " && !e.repeat) { e.preventDefault(); onCompare(t.file); } }}
          onKeyUp={(e) => { if (e.key === " ") { e.preventDefault(); onCompare(null); } }}
          onBlur={() => onCompare(null)}
          className={`bg-surface w-full shrink-0 overflow-hidden rounded border-2 ${t.file === current ? "border-accent" : "border-border"}`}>
          <img src={`/api/comfy/file/${t.file}`} alt="" draggable={false} className="aspect-square w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
