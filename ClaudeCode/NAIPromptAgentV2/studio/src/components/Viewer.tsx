"use client";
import { useEffect, useRef, useState } from "react";
import { lockScroll, unlockScroll } from "./Sheet";
import { canResend } from "@/lib/nai-body";
import type { Generation } from "./HistoryStrip";

type View = { s: number; x: number; y: number };
const ZERO: View = { s: 1, x: 0, y: 0 };

/**
 * Full-screen image viewer. Swipe left/right through history (at 1×), pinch or double-tap to zoom,
 * drag to pan when zoomed. Actions act on the image being shown.
 */
export function Viewer({ items, id, onId, onClose, onSave, onVary, onUpscale, onReuse }: {
  items: Generation[]; id: number | null; onId: (id: number) => void; onClose: () => void;
  onSave: (g: Generation) => void; onVary: (g: Generation) => void; onUpscale: (g: Generation) => void; onReuse: (g: Generation) => void;
}) {
  const [view, setView] = useState<View>(ZERO);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  // multi: this touch sequence had two fingers — never treat its end as a swipe, close or double tap.
  const gesture = useRef<{ dist: number; s: number; start: { x: number; y: number }; from: View; t: number; multi: boolean } | null>(null);
  const lastTap = useRef(0);
  // Tracked by id, not position: history can reload while the viewer is open (a generation finishing).
  const index = id === null ? -1 : items.findIndex((it) => it.id === id);
  const g = index < 0 ? null : items[index];
  const nav = useRef({ index, items, onId, onClose });
  nav.current = { index, items, onId, onClose };

  useEffect(() => { setView(ZERO); }, [id]);
  useEffect(() => { if (id !== null && !g) onClose(); }, [id, g, onClose]);
  const open = !!g;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const n = nav.current;
      if (e.key === "Escape") n.onClose();
      if (e.key === "ArrowRight" && n.index < n.items.length - 1) n.onId(n.items[n.index + 1].id);
      if (e.key === "ArrowLeft" && n.index > 0) n.onId(n.items[n.index - 1].id);
    };
    window.addEventListener("keydown", key);
    lockScroll();
    return () => { window.removeEventListener("keydown", key); unlockScroll(); };
  }, [open]);

  if (!g) return null;
  const go = (d: number) => { const t = items[index + d]; if (t) onId(t.id); };
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Image ${index + 1} of ${items.length}`} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center gap-3 p-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}>
        <span className="flex-1 font-mono text-xs opacity-80">{index + 1} / {items.length} · seed {g.seed}{g.params.upscaled ? " · 4×" : ""}</span>
        <button type="button" onClick={onClose} aria-label="Close viewer" className="grid size-11 place-items-center rounded-full bg-white/10 text-lg">×</button>
      </header>

      <div className="relative flex-1 touch-none overflow-hidden select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const multi = pts.current.size > 1 || !!gesture.current?.multi;
          gesture.current = { dist: pts.current.size === 2 ? dist() : 0, s: view.s, start: { x: e.clientX, y: e.clientY }, from: view, t: e.timeStamp, multi };
        }}
        onPointerMove={(e) => {
          if (!pts.current.has(e.pointerId) || !gesture.current) return;
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const gs = gesture.current;
          if (pts.current.size === 2 && gs.dist) setView({ ...gs.from, s: Math.min(5, Math.max(1, gs.s * (dist() / gs.dist))) });
          else if (view.s > 1) setView({ ...gs.from, x: gs.from.x + e.clientX - gs.start.x, y: gs.from.y + e.clientY - gs.start.y });
        }}
        onPointerUp={(e) => {
          const gs = gesture.current;
          pts.current.delete(e.pointerId);
          if (!gs) return;
          if (pts.current.size) {
            // One finger left after a pinch: carry on panning from where it is, at the pinched scale.
            const [rest] = [...pts.current.values()];
            gesture.current = { dist: 0, s: view.s, start: rest, from: view, t: e.timeStamp, multi: true };
            return;
          }
          gesture.current = null;
          if (gs.multi) return;
          const dx = e.clientX - gs.start.x, dy = e.clientY - gs.start.y;
          if (view.s <= 1.01) {
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
            else if (dy > 120 && Math.abs(dy) > Math.abs(dx)) onClose();
            setView(ZERO);
          }
          // Double tap toggles 2.5× / fit.
          if (Math.hypot(dx, dy) < 10 && e.timeStamp - gs.t < 250) {
            if (e.timeStamp - lastTap.current < 320) { setView(view.s > 1 ? ZERO : { s: 2.5, x: 0, y: 0 }); lastTap.current = 0; }
            else lastTap.current = e.timeStamp;
          }
        }}
        onPointerCancel={(e) => { pts.current.delete(e.pointerId); gesture.current = null; }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={g.id} src={`/api/gallery/${g.file}`} alt={`Generation ${g.id}`} draggable={false}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
          style={{ translate: `${view.x}px ${view.y}px`, scale: String(view.s), transition: gesture.current ? "none" : "scale 200ms var(--ease-out), translate 200ms var(--ease-out)" }} />
      </div>

      <nav aria-label="Image actions" className="grid grid-cols-4 gap-1 p-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
        {[
          ["Save", () => onSave(g), true],
          ["Variations", () => onVary(g), canResend(g.params)],
          ["Upscale", () => onUpscale(g), canResend(g.params)],
          ["Reuse", () => onReuse(g), true],
        ].map(([label, act, on]) => (
          <button key={label as string} type="button" disabled={!on} onClick={act as () => void}
            className="h-12 rounded-lg bg-white/10 text-sm font-medium disabled:opacity-30">{label as string}</button>
        ))}
      </nav>
    </div>
  );
}
