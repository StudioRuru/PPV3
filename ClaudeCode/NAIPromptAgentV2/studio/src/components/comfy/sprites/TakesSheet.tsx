"use client";
import { useEffect, useRef, useState } from "react";
import type { CellStatus } from "@/lib/sprites/core";
import type { CellView, TakeView } from "./grid";

const url = (f: string) => `/api/comfy/file/${f}`;
const tone: Record<CellStatus, string> = { empty: "text-faint border-border", queued: "text-warn border-warn", generating: "text-cyan border-cyan", review: "text-accent-ink border-accent", approved: "text-ok border-ok", rejected: "text-danger border-danger" };

export const Chip = ({ s }: { s: CellStatus }) => <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone[s]}`}>{s}</span>;

export function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

/** The approved take (else the first with a file) of a cell. */
export const shown = (c: CellView): TakeView | undefined => c.takes.find((t) => t.id === c.approvedTake && t.file) ?? c.takes.find((t) => t.file);

/** A take's media: looping muted mp4 (poster still under reduced motion); bases are plain images. */
export function Clip({ t, className = "" }: { t: TakeView; className?: string }) {
  const reduced = useReduced();
  if (!t.file) return null;
  if (!/\.(mp4|webm)$/i.test(t.file) || (reduced && t.poster)) return <img src={url(reduced && t.poster ? t.poster : t.file)} alt="" loading="lazy" className={className} />;
  return <video src={url(t.file)} poster={t.poster ? url(t.poster) : undefined} muted loop playsInline autoPlay preload="metadata" className={className} />;
}

/** Takes side by side, restarted together on open so the loops line up. */
export function TakesSheet({ cell, title, mirror, onClose, onAct }: {
  cell: CellView; title: string; mirror?: CellView | null; onClose: () => void; onAct: (cellId: number, body: object) => Promise<void>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const src = mirror ?? cell;
  const ts = src.takes.filter((t) => t.file);
  const sig = ts.map((t) => t.id).join();
  useEffect(() => { box.current?.querySelectorAll("video").forEach((v) => { v.currentTime = 0; void v.play().catch(() => {}); }); }, [sig]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const btn = "min-h-11 rounded-full border px-4 text-sm disabled:opacity-50";
  const busy = src.status === "queued" || src.status === "generating";
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="bg-bg fixed inset-0 z-50 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className={`${btn} border-border text-muted`}>Close</button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <Chip s={src.status} />
        </div>
        {mirror && <p className="text-muted text-sm">↺ reverse: this plays the mirror clip backwards.</p>}
        {ts.length === 0 && <p className="border-border text-muted rounded-lg border p-6 text-center text-sm">{busy ? "Generating — takes show up here." : "No takes yet."}</p>}
        <div ref={box} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ts.map((t, i) => (
            <figure key={t.id} className="border-border bg-surface space-y-2 rounded-lg border p-2">
              <Clip t={t} className="bg-bg mx-auto max-h-[60dvh] w-full rounded object-contain" />
              <figcaption className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">Take {i + 1}{t.id === src.approvedTake ? " · approved" : ""}</span>
                {!mirror && <button type="button" disabled={t.id === cell.approvedTake} onClick={() => void onAct(cell.id, { op: "approve", takeId: t.id })} className={`${btn} border-accent text-accent-ink`}>Use this</button>}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {mirror
            ? <button type="button" onClick={() => void onAct(cell.id, { op: "own", on: true })} className={`${btn} border-accent text-accent-ink`}>Generate own</button>
            : <>
              <button type="button" disabled={busy} onClick={() => void onAct(cell.id, { op: "generate", n: 3 })} className={`${btn} border-border`}>{ts.length ? "More takes" : "Generate"}</button>
              {ts.length > 0 && <button type="button" onClick={() => void onAct(cell.id, { op: "reject" })} className={`${btn} border-danger text-danger`}>Reject all</button>}
            </>}
        </div>
      </div>
    </div>
  );
}
