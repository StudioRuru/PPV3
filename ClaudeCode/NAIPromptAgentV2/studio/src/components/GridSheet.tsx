"use client";
import { useRef, useState } from "react";
import { gridLines, gridWeights, isFree, setLineWeight } from "@/lib/grid";
import type { NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import type { PromptState } from "@/lib/prompt";
import { developed } from "./HistoryStrip";
import { Sheet } from "./Sheet";

type Cell = { w: number; file?: string; error?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GridSheet({ open, onClose, state, params, onApply, onDone }: {
  open: boolean; onClose: () => void; state: PromptState; params: NaiParams;
  onApply: (s: PromptState) => void; onDone: () => void;
}) {
  const [lineId, setLineId] = useState("");
  const [min, setMin] = useState(0.6);
  const [max, setMax] = useState(1.4);
  const [steps, setSteps] = useState(5);
  const [cells, setCells] = useState<Cell[]>([]);
  const [running, setRunning] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const stop = useRef(false);

  // The run keeps going while the sheet is closed; only the view is hidden (Sheet stays mounted).
  const lines = gridLines(state);
  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  const weights = gridWeights(min, max, steps);

  async function run() {
    if (!line) return;
    stop.current = false; setRunning(true); setApplied(null);
    const seed = params.seed && params.seed > 0 ? params.seed : 1 + Math.floor(Math.random() * (2 ** 32 - 1));
    const gridId = `g${Date.now().toString(36)}`;
    const out: Cell[] = weights.map((w) => ({ w }));
    setCells([...out]);
    for (let i = 0; i < weights.length; i++) {
      // ~2 s between cells keeps the request pattern human-paced (spec §4.3).
      if (i) await sleep(2000);
      if (stop.current) break;
      const r = await requestJson<{ file: string }>("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: setLineWeight(state, line.id, weights[i]), params: { ...params, seed }, gridId }),
      });
      out[i] = r.ok ? { w: weights[i], file: r.data.file } : { w: weights[i], error: r.error };
      setCells([...out]);
      if (!r.ok) break;
    }
    setRunning(false); onDone();
  }

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value) || 0);
  const field = "bg-bg border-border w-20 rounded-md border px-2 py-2 text-base";
  const error = cells.find((c) => c.error)?.error;

  return (
    <Sheet open={open} onClose={onClose} label="Strength grid" closeLabel="Close grid"
      className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="flex-1 text-base font-semibold">Strength grid</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {!lines.length ? <p className="text-muted text-sm">Write a prompt line first, then grid its weight.</p> : <>
            <label className="block text-sm">
              <span className="text-muted mb-1 block text-xs font-medium tracking-wide uppercase">Line</span>
              <select value={line?.id} onChange={(e) => setLineId(e.target.value)} disabled={running} className="bg-bg border-border w-full rounded-md border px-2 py-2.5 text-base">
                {lines.map((l) => <option key={l.id} value={l.id}>{l.where}: {l.text.length > 60 ? `${l.text.slice(0, 60)}…` : l.text}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label><span className="text-muted mb-1 block text-xs">Min</span><input type="number" step="0.05" inputMode="decimal" value={min} onChange={num(setMin)} disabled={running} className={field} /></label>
              <label><span className="text-muted mb-1 block text-xs">Max</span><input type="number" step="0.05" inputMode="decimal" value={max} onChange={num(setMax)} disabled={running} className={field} /></label>
              <div role="radiogroup" aria-label="Steps" className="border-border flex overflow-hidden rounded-md border">
                {[3, 4, 5, 6].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={steps === n} disabled={running} onClick={() => setSteps(n)}
                    className={`h-11 w-11 ${steps === n ? "bg-accent text-accent-fg font-semibold" : ""}`}>{n}</button>
                ))}
              </div>
            </div>
            <p className="text-muted text-sm">
              {weights.join(" · ")}<br />
              {weights.length} images on one seed · {isFree(params) ? "free on Opus (≤1 Mpx, ≤28 steps)" : <span className="text-danger">costs Anlas for each image</span>}
            </p>
            {cells.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {cells.map((c, i) => (
                  <button key={i} type="button" disabled={!c.file} aria-pressed={applied === i} style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => { onApply(setLineWeight(state, line!.id, c.w)); setApplied(i); }}
                    className={`animate-rise overflow-hidden rounded-md border text-left ${applied === i ? "border-accent ring-accent ring-2" : "border-border"} ${applied !== null && applied !== i && c.file ? "opacity-60" : ""}`}>
                    {c.file
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`/api/gallery/${c.file}`} alt={`Weight ${c.w}`} onLoad={developed} onError={developed} className="animate-develop w-full" style={{ aspectRatio: `${params.width}/${params.height}` }} />
                      : <div className={`bg-bg text-muted grid place-items-center font-mono text-xs ${running && !c.error ? "sweep" : ""}`} style={{ aspectRatio: `${params.width}/${params.height}` }}>{c.error ? "failed" : running ? "…" : "—"}</div>}
                    <div className="px-1.5 py-1 font-mono text-xs tabular-nums">{c.w}{applied === i ? " · applied" : ""}</div>
                  </button>
                ))}
              </div>
            )}
            {cells.some((c) => c.file) && !running && <p className="text-muted text-xs">Tap a cell to use that weight.</p>}
            {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          </>}
        </div>
        <div className="border-border border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          {running
            ? <button type="button" onClick={() => { stop.current = true; }} className="border-border w-full rounded-lg border px-4 py-3 font-semibold">Stop after this cell</button>
            : <button type="button" onClick={run} disabled={!line} className="bg-accent text-accent-fg w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-40">Run {weights.length} cells</button>}
        </div>
    </Sheet>
  );
}
