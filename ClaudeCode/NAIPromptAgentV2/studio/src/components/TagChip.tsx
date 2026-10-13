"use client";
import { useRef } from "react";

type Props = {
  tag: string; dropped: boolean; weight?: number;
  onToggle: () => void; onBoost: () => void;
  onDragMove: (x: number, y: number) => void; onDragEnd: (x: number, y: number) => void;
};

export function TagChip({ tag, dropped, weight, onToggle, onBoost, onDragMove, onDragEnd }: Props) {
  const start = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout>; mode: "tap" | "drag" | "held" } | null>(null);

  return (
    <button
      type="button"
      aria-pressed={!dropped}
      aria-label={`${tag}${weight ? ` weight ${weight}` : ""}${dropped ? ", dropped" : ""}`}
      className={`touch-none select-none rounded-md border px-2.5 py-1.5 text-sm ${
        dropped ? "border-border text-muted border-dashed line-through" : weight ? "border-accent bg-surface-2" : "border-border bg-surface"
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const t = setTimeout(() => { if (start.current?.mode === "tap") { start.current.mode = "held"; onBoost(); } }, 450);
        start.current = { x: e.clientX, y: e.clientY, t, mode: "tap" };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (s.mode === "tap" && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) { clearTimeout(s.t); s.mode = "drag"; }
        if (s.mode === "drag") onDragMove(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        clearTimeout(s.t);
        if (s.mode === "tap") onToggle();
        if (s.mode === "drag") onDragEnd(e.clientX, e.clientY);
      }}
      onPointerCancel={() => { if (start.current) clearTimeout(start.current.t); start.current = null; onDragEnd(-1, -1); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {tag}
      {weight ? <b className="text-accent ml-1 text-xs">{weight}</b> : null}
    </button>
  );
}
