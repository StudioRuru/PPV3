"use client";
import { useEffect, useRef } from "react";

let locks = 0; // page scroll stays locked while any sheet or the viewer is open
export function lockScroll() { if (++locks === 1) document.documentElement.style.overflow = "hidden"; }
export function unlockScroll() { if (--locks === 0) document.documentElement.style.overflow = ""; }

// Bottom sheet (right-hand panel on desktop). Always mounted so it can animate out;
// closed = visibility:hidden + inert, so it is untouchable and out of the a11y tree.
// Phone: drag the grabber or header down to close. Focus moves in on open and back on close.
export function Sheet({ open, onClose, label, closeLabel, className, children }: {
  open: boolean; onClose: () => void; label: string; closeLabel: string; className: string; children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    lockScroll();
    panel.current?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("mascot:stage", { detail: "sheet" })); // Miyabi peeks in
    return () => {
      unlockScroll();
      back?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const end = (close: boolean) => {
    drag.current = null;
    const p = panel.current;
    if (p) { p.style.translate = ""; p.style.transition = ""; }
    if (close) onClose();
  };

  return (
    <div className="sheet fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end" data-open={open || undefined} inert={!open}
      role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="sheet-backdrop absolute inset-0 bg-black/50" />
      <section ref={panel} tabIndex={-1} className={`sheet-panel bg-surface border-border relative flex w-full flex-col outline-none ${className}`}
        onPointerDown={(e) => {
          // Only from the grabber/header, never from controls or scrolling content, and only on phone layouts.
          const t = e.target as HTMLElement;
          if (window.matchMedia("(min-width: 64rem)").matches || !t.closest("header,[data-grab]") || t.closest("button,input,select,textarea,a")) return;
          drag.current = { y: e.clientY, t: e.timeStamp, dy: 0 };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.transition = "none";
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.dy = Math.max(0, e.clientY - d.y);
          e.currentTarget.style.translate = `0 ${d.dy}px`;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d) end(d.dy > 110 || d.dy / Math.max(1, e.timeStamp - d.t) > 0.6);
        }}
        onPointerCancel={() => end(false)}>
        <div data-grab aria-hidden="true" className="flex h-6 shrink-0 cursor-grab touch-none items-end justify-center lg:hidden">
          <span className="bg-border h-1 w-9 rounded-full" />
        </div>
        {children}
      </section>
    </div>
  );
}
