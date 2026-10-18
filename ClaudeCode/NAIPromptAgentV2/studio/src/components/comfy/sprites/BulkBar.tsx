"use client";
import { useState } from "react";
import type { Surface } from "@/lib/sprites/core";
import { requestJson } from "@/lib/net";

type Est = { jobs: number; seconds: number; usd: number };
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Generate missing: estimate first, run only after Confirm. */
export function BulkBar({ surface, outfit, bulk, onChange }: { surface: Surface; outfit: string; bulk: { queued: number; running: number }; onChange: () => void }) {
  const [scope, setScope] = useState<"basic" | "all">("basic");
  const [est, setEst] = useState<Est | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const call = async (extra: object) => {
    setBusy(true);
    const r = await requestJson<Est & { cancelled?: number }>("/api/sprites/bulk", post({ surface, outfit, scope, ...extra }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return null; }
    setError(null);
    return r.data;
  };
  const ask = async () => setEst(await call({}));
  const go = async () => { if (await call({ confirm: true })) { setEst(null); onChange(); } };
  const cancel = async () => { if (await call({ cancel: true })) onChange(); };
  const btn = "min-h-11 rounded-full border px-4 text-sm disabled:opacity-50";
  const active = bulk.queued + bulk.running;
  return (
    <div className="border-border bg-surface space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Scope" className="border-border flex overflow-hidden rounded-full border">
          {(["basic", "all"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => { setScope(s); setEst(null); }} className={`h-11 px-4 text-sm ${scope === s ? "bg-accent text-accent-fg font-semibold" : "text-muted"}`}>{s === "basic" ? "Basic" : "All"}</button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => void ask()} className={`${btn} border-accent text-accent-ink`}>Generate missing</button>
        {active > 0 && <>
          <span className="text-muted text-sm" role="status">{bulk.running} running · {bulk.queued} queued</span>
          <button type="button" disabled={busy} onClick={() => void cancel()} className={`${btn} border-danger text-danger`}>Cancel</button>
        </>}
      </div>
      {est && (est.jobs === 0
        ? <p className="text-muted text-sm">Nothing missing. Approve the base first if the list is empty.</p>
        : <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{est.jobs} clips · ~{(est.seconds / 3600).toFixed(1)} h · ~${est.usd.toFixed(2)}</span>
          <button type="button" disabled={busy} onClick={() => void go()} className={`${btn} bg-accent text-accent-fg border-accent font-semibold`}>Confirm</button>
          <button type="button" onClick={() => setEst(null)} className={`${btn} border-border text-muted`}>Dismiss</button>
        </div>)}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    </div>
  );
}
