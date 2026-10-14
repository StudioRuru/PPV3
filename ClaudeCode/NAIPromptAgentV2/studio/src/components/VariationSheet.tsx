"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/net";
import type { Generation } from "./HistoryStrip";
import { developed } from "./HistoryStrip";
import { Sheet } from "./Sheet";

type Cell = { id?: number; file?: string; error?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const closeness = (s: number) => (s < 0.35 ? "Subtle" : s < 0.55 ? "Close" : "Loose");

/** Current Anlas, or null while unknown/unreachable. Shown before anything that may spend, diffed after. */
export function useAnlas(open: boolean) {
  const [anlas, setAnlas] = useState<number | null>(null);
  const refresh = () => requestJson<{ anlas: number }>("/api/anlas").then((r) => { const v = r.ok ? r.data.anlas : null; setAnlas(v); return v; });
  useEffect(() => { if (open) refresh(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { anlas, refresh };
}

/** 2×2 image-to-image variations of one saved image: same recipe, four new seeds, 2 s apart. */
export function VariationSheet({ source: open, onClose, onPick, onDone }: {
  source: Generation | null; onClose: () => void; onPick: (id: number) => void; onDone: () => void;
}) {
  // Keep showing the last image while the sheet animates out.
  const last = useRef(open);
  if (open) last.current = open;
  const source = last.current;
  const [strength, setStrength] = useState(0.4);
  const [cells, setCells] = useState<Cell[]>([]);
  const [running, setRunning] = useState(false);
  const [spent, setSpent] = useState<number | null>(null);
  const stop = useRef(false);
  const { anlas, refresh } = useAnlas(!!open);

  useEffect(() => { setCells([]); setSpent(null); }, [source?.id]);

  async function run() {
    if (!source) return;
    stop.current = false; setRunning(true); setSpent(null);
    const before = await refresh();
    const gridId = `v${Date.now().toString(36)}`;
    const out: Cell[] = [{}, {}, {}, {}];
    setCells([...out]);
    for (let i = 0; i < 4; i++) {
      if (i) await sleep(2000);
      if (stop.current) break;
      const seed = 1 + Math.floor(Math.random() * (2 ** 32 - 1));
      const r = await requestJson<{ id: number; file: string }>("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { id: source.id, strength, noise: 0 }, params: { seed }, gridId }),
      });
      out[i] = r.ok ? r.data : { error: r.error };
      setCells([...out]);
      if (!r.ok) break;
    }
    const after = await refresh();
    if (before !== null && after !== null) setSpent(before - after);
    setRunning(false); onDone();
  }

  const ratio = source ? `${source.params.width}/${source.params.height}` : "2/3";
  const error = cells.find((c) => c.error)?.error;
  return (
    <Sheet open={!!open} onClose={onClose} label="Variations" closeLabel="Close variations"
      className="max-h-[92dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Variations</h2>
        <span className="text-muted font-mono text-[11px]">{anlas === null ? "" : `${anlas.toLocaleString()} Anlas`}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {source && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/gallery/${source.file}`} alt="Source image" className="border-border h-20 rounded-md border" style={{ aspectRatio: ratio }} />
            <p className="text-muted text-sm">Four new takes on this image, keeping its recipe. Use closeness to choose how far they may wander.</p>
          </div>
        )}
        <label className="block text-sm">
          <span className="flex justify-between"><span>Closeness</span><span className="text-accent font-mono text-xs">{closeness(strength)} · {strength.toFixed(2)}</span></span>
          <input type="range" min={0.2} max={0.8} step={0.05} value={strength} disabled={running} onChange={(e) => setStrength(Number(e.target.value))}
            className="accent-accent mt-2 h-8 w-full" aria-label="Closeness — lower stays nearer the original" />
          <span className="text-faint flex justify-between font-mono text-[11px]"><span>subtle</span><span>loose</span></span>
        </label>
        {cells.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {cells.map((c, i) => (
              <button key={i} type="button" disabled={!c.id} onClick={() => { onPick(c.id!); onClose(); }} aria-label={`Use variation ${i + 1}`}
                className="border-border overflow-hidden rounded-md border">
                {c.file
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/gallery/${c.file}`} alt="" onLoad={developed} onError={developed} className="animate-develop w-full" style={{ aspectRatio: ratio }} />
                  : <div className={`bg-bg grid place-items-center text-xs ${running && !c.error ? "sweep" : ""}`} style={{ aspectRatio: ratio }}>{c.error ? "failed" : running ? "" : "—"}</div>}
              </button>
            ))}
          </div>
        )}
        {spent !== null && <p className="text-muted font-mono text-xs">{spent > 0 ? `Spent ${spent} Anlas` : "No Anlas spent"}</p>}
        {cells.some((c) => c.id) && !running && <p className="text-muted text-xs">Tap one to make it the current image.</p>}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </div>
      <div className="border-border border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {running
          ? <button type="button" onClick={() => { stop.current = true; }} className="border-border w-full rounded-lg border px-4 py-3 font-semibold">Stop after this one</button>
          : <button type="button" onClick={run} disabled={!source} className="bg-accent text-accent-fg w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-40">{cells.length ? "Make 4 more" : "Make 4 variations"}</button>}
      </div>
    </Sheet>
  );
}

/** Confirm-first NovelAI 4× upscale: balance before, exact spend after. */
export function UpscaleSheet({ source: open, onClose, onDone }: { source: Generation | null; onClose: () => void; onDone: (id: number) => void }) {
  const last = useRef(open);
  if (open) last.current = open;
  const source = last.current;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ spent: number | null; id: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { anlas, refresh } = useAnlas(!!open);
  useEffect(() => { setResult(null); setError(null); }, [source?.id]);

  async function run() {
    if (!source) return;
    setBusy(true); setError(null);
    const before = await refresh();
    const r = await requestJson<{ id: number }>("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: source.id }) });
    const after = await refresh();
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setResult({ id: r.data.id, spent: before !== null && after !== null ? before - after : null });
    onDone(r.data.id);
  }

  const w = source?.params.width ?? 0, h = source?.params.height ?? 0;
  return (
    <Sheet open={!!open} onClose={onClose} label="Upscale" closeLabel="Close upscale"
      className="rounded-t-2xl border-t lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Upscale 4×</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="font-mono">{w}×{h} → <span className="text-accent">{w * 4}×{h * 4}</span></p>
        <p className="text-muted">NovelAI's upscaler. <span className="text-warn">This spends Anlas</span> — NovelAI doesn't say how many up front, so the exact amount is shown after.</p>
        <p className="font-mono text-xs">Balance: {anlas === null ? "…" : `${anlas.toLocaleString()} Anlas`}</p>
        {result && <p role="status" className="text-ok">Done{result.spent !== null ? ` — spent ${result.spent} Anlas` : ""}. It's now the current image.</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
      <div className="border-border border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {result
          ? <button type="button" onClick={onClose} className="border-border w-full rounded-lg border px-4 py-3 font-semibold">Close</button>
          : <button type="button" onClick={run} disabled={busy || !source} className="bg-accent text-accent-fg w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-40">{busy ? "Upscaling…" : "Upscale — spend Anlas"}</button>}
      </div>
    </Sheet>
  );
}
