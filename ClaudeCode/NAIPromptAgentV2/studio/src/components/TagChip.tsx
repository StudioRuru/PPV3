"use client";
import { useRef } from "react";
import { dragIntent } from "@/lib/tagger";

type Props = {
  tag: string; dropped: boolean; weight?: number; index?: number;
  onToggle: () => void; onBoost: () => void;
  onDragMove: (x: number, y: number) => void; onDragEnd: (x: number, y: number) => void;
};

export function TagChip({ tag, dropped, weight, index = 0, onToggle, onBoost, onDragMove, onDragEnd }: Props) {
  const start = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout>; mode: "tap" | "drag" | "held"; id: number } | null>(null);

  return (
    <button
      type="button"
      aria-pressed={!dropped}
      aria-label={`${tag}${weight ? ` weight ${weight}` : ""}${dropped ? ", dropped" : ""}`}
      style={{ animationDelay: `${Math.min(index, 24) * 18}ms` }}
      className={`animate-rise touch-pan-y select-none [-webkit-touch-callout:none] rounded-md border px-2.5 py-1.5 text-sm ${
        dropped ? "border-border text-muted border-dashed line-through" : weight ? "border-accent bg-surface-2" : "border-border bg-surface"
      }`}
      onPointerDown={(e) => {
        if (start.current) return; // second finger: keep the first gesture
        e.currentTarget.setPointerCapture(e.pointerId);
        const t = setTimeout(() => { if (start.current?.mode === "tap") { start.current.mode = "held"; onBoost(); } }, 450);
        start.current = { x: e.clientX, y: e.clientY, t, mode: "tap", id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        if (s.mode === "tap" && dragIntent(e.clientX - s.x, e.clientY - s.y, e.pointerType) === "drag") { clearTimeout(s.t); s.mode = "drag"; }
        if (s.mode === "drag") onDragMove(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        start.current = null;
        clearTimeout(s.t);
        if (s.mode === "tap") onToggle();
        if (s.mode === "drag") onDragEnd(e.clientX, e.clientY);
      }}
      onPointerCancel={(e) => { if (start.current?.id !== e.pointerId) return; if (start.current) clearTimeout(start.current.t); start.current = null; onDragEnd(-1, -1); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {tag}
      {weight ? <b className="text-accent animate-rise ml-1 inline-block text-xs">{weight}</b> : null}
    </button>
  );
}
