"use client";
import { useState } from "react";
import { EXPORT_CAP, pickRows, type ExportPick } from "@/lib/export";
import type { Generation } from "./HistoryStrip";
import { Sheet } from "./Sheet";

type Mode = "today" | "last" | "select";

/** Zip of full PNGs (recipes intact) — gets generations off the Mac and onto the phone / Files. */
export function ExportSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: Generation[] }) {
  const [mode, setMode] = useState<Mode>("today");
  const [last, setLast] = useState(20);
  const [picked, setPicked] = useState<number[]>([]);

  const pick: ExportPick = mode === "today" ? { today: true } : mode === "last" ? { last } : { ids: picked };
  const rows = items.map((g) => ({ id: g.id, created_at: g.created_at ?? 0 }));
  const count = pickRows(rows, pick).length;
  const query = mode === "today" ? "today=1" : mode === "last" ? `last=${last}` : `ids=${picked.join(",")}`;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function download() {
    // In the iOS shell an attachment becomes a share sheet (Save to Files); in a browser, a download.
    const a = document.createElement("a");
    a.href = `/api/export?${query}`; a.download = ""; a.click();
  }

  return (
    <Sheet open={open} onClose={onClose} label="Export" closeLabel="Close export"
      className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Save session to zip</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-3">
        <div role="radiogroup" aria-label="What to export" className="border-border grid grid-cols-3 overflow-hidden rounded-lg border text-sm">
          {([["today", "Today"], ["last", "Last N"], ["select", "Select"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`h-11 ${mode === m ? "bg-accent text-accent-fg font-semibold" : ""}`}>{label}</button>
          ))}
        </div>
        {mode === "last" && (
          <label className="flex items-center gap-3 text-sm">Newest
            <input type="number" min={1} max={EXPORT_CAP} inputMode="numeric" value={last} onChange={(e) => setLast(Math.min(EXPORT_CAP, Math.max(1, Number(e.target.value) || 1)))}
              className="bg-bg border-border w-24 rounded-md border px-2 py-2 font-mono text-base" />images
          </label>
        )}
        {mode === "select" && (
          <div className="grid grid-cols-4 gap-1.5">
            {items.map((g) => (
              <button key={g.id} type="button" aria-pressed={picked.includes(g.id)} onClick={() => toggle(g.id)} aria-label={`Image ${g.id}`}
                className={`relative overflow-hidden rounded-md border-2 ${picked.includes(g.id) ? "border-accent" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/gallery/${g.file}`} alt="" loading="lazy" className={`aspect-square w-full object-cover ${picked.includes(g.id) ? "" : "opacity-70"}`} />
                {picked.includes(g.id) && <span aria-hidden="true" className="bg-accent text-accent-fg absolute top-1 right-1 grid size-5 place-items-center rounded-full text-xs">✓</span>}
              </button>
            ))}
          </div>
        )}
        <p className="text-muted text-sm">Full-size PNGs with their NovelAI recipes, plus a recipes.json. Everything also stays on the Mac.</p>
      </div>
      <div className="border-border border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <button type="button" disabled={!count} onClick={download} className="bg-accent text-accent-fg w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-40">
          {count ? `Download zip · ${count} image${count === 1 ? "" : "s"}` : "No images selected"}
        </button>
      </div>
    </Sheet>
  );
}
