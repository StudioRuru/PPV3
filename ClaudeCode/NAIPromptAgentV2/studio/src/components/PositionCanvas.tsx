"use client";
import { useRef, useState } from "react";
import { clampRegion, positionWords, regionOf, resizeRegion, type CharBox, type Region } from "@/lib/prompt";
import { DOT } from "./BlockDrawer";

type Drag = { i: number; mode: "move" | "size"; start: { x: number; y: number }; from: Region };

/**
 * V5 character placement as boxes on a canvas shaped like the image. Drag a box to move it, drag its
 * corner to resize; tap empty space to move the selected box there. The centre is what NovelAI gets;
 * position and size also become words in the prompt (see positionWords).
 */
export function PositionCanvas({ chars, width, height, onChange, words = true }: {
  chars: CharBox[]; width: number; height: number; onChange: (c: CharBox[]) => void; words?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const drag = useRef<Drag | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const set = (i: number, reg: Region) => {
    const region = clampRegion(reg);
    onChange(chars.map((c, j) => (j === i ? { ...c, region, center: { x: region.x, y: region.y } } : c)));
  };
  const start = (e: React.PointerEvent, i: number, mode: Drag["mode"]) => {
    e.stopPropagation();
    box.current!.setPointerCapture(e.pointerId);
    setActive(i);
    drag.current = { i, mode, start: at(e), from: regionOf(chars[i], i, chars.length) };
  };

  return (
    <div
      ref={box}
      role="application"
      aria-label="Character positions — drag a box to move it, drag its corner to resize, or tap to place the selected character"
      className="bg-bg border-border relative mx-auto w-full max-w-xs touch-none overflow-hidden rounded-md border select-none"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => {
        if (e.target !== box.current || !chars[active]) return;
        set(active, { ...regionOf(chars[active], active, chars.length), ...at(e) });
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = at(e), dx = p.x - d.start.x, dy = p.y - d.start.y;
        set(d.i, d.mode === "move" ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy } : resizeRegion(d.from, dx, dy));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      {chars.map((c, i) => {
        const r = regionOf(c, i, chars.length);
        const color = DOT[i % DOT.length];
        return (
          <div key={c.id}
            className={`absolute rounded-md border-2 ${c.enabled ? "" : "opacity-40"} ${i === active ? "z-10" : ""}`}
            style={{ left: `${(r.x - r.w / 2) * 100}%`, top: `${(r.y - r.h / 2) * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
              borderColor: color, background: `color-mix(in srgb, ${color} ${i === active ? 22 : 12}%, transparent)` }}>
            <button type="button" aria-label={`Move character ${i + 1}: ${words ? positionWords(r) : `${r.x}, ${r.y}`}`}
              onPointerDown={(e) => start(e, i, "move")} className="absolute inset-0 cursor-move" />
            <span aria-hidden="true" className="pointer-events-none absolute top-1 left-1 grid size-6 place-items-center rounded-full font-mono text-xs font-semibold"
              style={{ background: color, color: "#11131f" /* dark on the pastel dot colours, every theme */ }}>{i + 1}</span>
            {/* 44px touch target around a small visible corner grip. */}
            <button type="button" aria-label={`Resize character ${i + 1}`} onPointerDown={(e) => start(e, i, "size")}
              className="absolute -right-3 -bottom-3 grid size-11 cursor-nwse-resize place-items-center">
              <span aria-hidden="true" className="size-3.5 rounded-sm border-2" style={{ borderColor: color, background: "var(--color-bg)" }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
