"use client";
import { useCallback, useEffect, useState } from "react";
import { CharacterBoxes } from "@/components/CharacterBoxes";
import { HistoryStrip, type Generation } from "@/components/HistoryStrip";
import { LineList } from "@/components/LineList";
import { ParamsBar } from "@/components/ParamsBar";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { emptyState, type PromptState } from "@/lib/prompt";

const DRAFT = "studio-draft-v1";

export default function Studio() {
  const [state, setState] = useState<PromptState>(emptyState);
  const [params, setParams] = useState<NaiParams>(DEFAULT_PARAMS);
  const [history, setHistory] = useState<Generation[]>([]);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await requestJson<{ items: Generation[] }>("/api/generations?limit=60");
    const items = r.ok ? r.data.items : [];
    setHistory(items);
    return items;
  }, []);

  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null"); if (d) { setState(d.state); setParams(d.params); } } catch {}
    loadHistory().then((items) => setCurrent(items[0] ?? null));
  }, [loadHistory]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify({ state, params })); } catch {}
  }, [state, params]);

  async function generate() {
    setBusy(true); setError(null);
    const r = await requestJson<{ id: number }>("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, params }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const items = await loadHistory();
    setCurrent(items.find((g) => g.id === r.data.id) ?? null);
  }

  function reuse(g: Pick<Generation, "state" | "params">) {
    setState(g.state);
    setParams({ ...DEFAULT_PARAMS, ...g.params });
  }

  async function onDrop(file: File) {
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<Pick<Generation, "state" | "params">>("/api/recipe", { method: "POST", body: fd });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    reuse({ state: r.data.state, params: { ...params, ...r.data.params } });
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 pb-28 lg:grid-cols-[1fr_1fr]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onDrop(f); }}>
      <section className="space-y-4">
        <ParamsBar params={params} onParams={setParams} rating={state.rating} onRating={(rating) => setState({ ...state, rating })} />
        <div className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Base prompt</h2>
          <LineList lines={state.base} onChange={(base) => setState({ ...state, base })} />
        </div>
        <CharacterBoxes chars={state.chars} onChange={(chars) => setState({ ...state, chars })} />
        <div className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Undesired content</h2>
          <textarea value={state.uc} onChange={(e) => setState({ ...state, uc: e.target.value })} rows={3}
            className="bg-bg border-border w-full rounded-md border px-2 py-2 text-base" />
        </div>
        <label className="text-muted block text-sm">
          Load recipe from a NovelAI PNG
          <input type="file" accept="image/png" className="mt-1 block" onChange={(e) => e.target.files?.[0] && onDrop(e.target.files[0])} />
        </label>
      </section>

      <section className="space-y-3">
        {current ? (
          <figure className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/gallery/${current.file}`} alt="Latest generation" className="border-border w-full rounded-lg border" />
            <figcaption className="text-muted flex items-center justify-between text-sm">
              <span>seed {current.seed}</span>
              <button type="button" className="text-accent" onClick={() => reuse(current)}>Reuse recipe</button>
            </figcaption>
          </figure>
        ) : <div className="border-border text-muted grid aspect-[832/1216] place-items-center rounded-lg border">Nothing yet</div>}
        <HistoryStrip items={history} onOpen={setCurrent} />
      </section>

      <div className="bg-bg/90 border-border fixed inset-x-0 bottom-0 border-t p-3 backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {error && <p role="alert" className="text-danger flex-1 text-sm">{error}</p>}
          <button type="button" onClick={generate} disabled={busy}
            className="bg-accent text-accent-fg ml-auto rounded-lg px-6 py-3 text-base font-semibold disabled:opacity-50">
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </main>
  );
}
