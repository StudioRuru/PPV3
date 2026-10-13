"use client";
import { useRef, useState } from "react";
import { defaultCenter, type CharBox } from "@/lib/prompt";

const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

/**
 * V5 character placement: one numbered dot per character on a canvas shaped like the image.
 * Drag a dot, or tap empty space to move the selected character there.
 */
export function PositionCanvas({ chars, width, height, onChange }: {
  chars: CharBox[]; width: number; height: number; onChange: (c: CharBox[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const place = (i: number, center: { x: number; y: number }) =>
    onChange(chars.map((c, j) => (j === i ? { ...c, center } : c)));

  return (
    <div
      ref={box}
      role="application"
      aria-label="Character positions — drag a dot or tap to place the selected character"
      className="bg-bg border-border relative mx-auto w-full max-w-xs touch-none overflow-hidden rounded-md border"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => { if (e.target === box.current && chars[active]) place(active, at(e)); }}
      onPointerMove={(e) => { if (dragging !== null) place(dragging, at(e)); }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      {chars.map((c, i) => {
        const p = c.center ?? defaultCenter(i, chars.length);
        return (
          <button
            key={c.id}
            type="button"
            aria-label={`Character ${i + 1} at ${p.x}, ${p.y}`}
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.parentElement!.setPointerCapture(e.pointerId); setActive(i); setDragging(i); }}
            className={`absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-sm font-semibold shadow ${
              i === active ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg"
            } ${c.enabled ? "" : "opacity-40"}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
