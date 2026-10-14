"use client";
import { useCallback, useEffect, useState } from "react";
import { BlockDrawer } from "@/components/BlockDrawer";
import { ChatSheet, type ChatSeed } from "@/components/ChatSheet";
import { CharacterBoxes } from "@/components/CharacterBoxes";
import { FindSheet } from "@/components/FindSheet";
import { GridSheet } from "@/components/GridSheet";
import { developed, HistoryStrip, type Generation } from "@/components/HistoryStrip";
import { LineList } from "@/components/LineList";
import { ParamsBar } from "@/components/ParamsBar";
import { TaggerPane } from "@/components/TaggerPane";
import { applyBlock, loadScene, type Block } from "@/lib/blocks";
import { loadDraft, saveDraft } from "@/lib/draft";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { applyOps } from "@/lib/patch";
import { isFree } from "@/lib/grid";
import { recreate } from "@/lib/recreate";
import type { RawTag } from "@/lib/tagger";
import { applyTags, emptyState, type PromptState } from "@/lib/prompt";
import { BUILTIN_PRESETS, type Preset } from "@/lib/tagger";

export default function Studio() {
  const [state, setState] = useState<PromptState>(emptyState);
  const [params, setParams] = useState<NaiParams>(DEFAULT_PARAMS);
  const [history, setHistory] = useState<Generation[]>([]);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saving before the draft has loaded would overwrite it with the empty initial state.
  const [loaded, setLoaded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [preset, setPreset] = useState<Preset>(BUILTIN_PRESETS[0]);
  const [tagText, setTagText] = useState("");
  const [chat, setChat] = useState(false);
  const [seed, setSeed] = useState<ChatSeed>(null);
  const [grid, setGrid] = useState(false);
  const [undo, setUndo] = useState<PromptState | null>(null);
  const [find, setFind] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Set when running inside the iOS shell (WKWebView with the "studio" message handler).
  const [native, setNative] = useState(false);

  useEffect(() => {
    const w = window as unknown as { webkit?: { messageHandlers?: { studio?: unknown } }; studioImport?: unknown; studioToast?: unknown };
    setNative(!!w.webkit?.messageHandlers?.studio);
    // iOS share sheet → app → here: the image goes to the Tagger as if picked.
    w.studioImport = async (dataUrl: string, name = "shared.jpg") => {
      const blob = await (await fetch(dataUrl)).blob();
      setIncoming(new File([blob], name, { type: blob.type }));
    };
    w.studioToast = (msg: string) => setNote(msg);
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);
  const [incoming, setIncoming] = useState<File | null>(null);

  function doRecreate(tags: RawTag[]) {
    setUndo(state);
    setState((s) => recreate(tags, s));
  }
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(t);
  }, [undo]);

  function dropTags(text: string, target: "base" | number | "new") {
    if (!text) return;
    setState((s) => applyTags(s, target === "new" ? s.chars.length : target, "append", text));
  }

  function sendBlocks(picked: Block[], target: "base" | number) {
    setState((s) => picked.reduce((acc, b) => applyBlock(acc, b, target), tagText ? applyTags(s, target, "append", tagText) : s));
  }

  const loadHistory = useCallback(async () => {
    const r = await requestJson<{ items: Generation[] }>("/api/generations?limit=60");
    const items = r.ok ? r.data.items : [];
    setHistory(items);
    return items;
  }, []);

  useEffect(() => {
    const d = loadDraft();
    if (d) { setState({ ...emptyState(), ...d.state }); setParams({ ...DEFAULT_PARAMS, ...d.params }); }
    setLoaded(true);
    loadHistory().then((items) => setCurrent(items[0] ?? null));
  }, [loadHistory]);

  useEffect(() => {
    if (loaded) saveDraft({ state, params });
  }, [loaded, state, params]);

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
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 pb-28 lg:grid-cols-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onDrop(f); }}>
      <section className="space-y-4">
        <TaggerPane preset={preset} onTagged={() => setDrawer(true)} onDrop={dropTags}
          onRecipe={(r) => reuse({ state: r.state, params: { ...params, ...r.params } })} onText={setTagText}
          onRecreate={doRecreate} incoming={incoming}
          onScene={(file, tags) => { setSeed({ text: `Make this a scene. Tags: ${tags}`, image: file, tags }); setChat(true); }} />
        <div className="flex gap-2">
          <button type="button" onClick={() => setDrawer(true)} className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm">
            Building blocks
          </button>
          <button type="button" onClick={() => setFind(true)} className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm">
            Find on Danbooru
          </button>
        </div>
        <ParamsBar params={params} onParams={setParams} rating={state.rating} onRating={(rating) => setState({ ...state, rating })} />
        <div data-drop="base" className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Base prompt</h2>
          <LineList lines={state.base} onChange={(base) => setState({ ...state, base })} />
        </div>
        <CharacterBoxes chars={state.chars} onChange={(chars) => setState({ ...state, chars })}
          positions={state.positions ?? "ai"} onPositions={(positions) => setState({ ...state, positions })}
          words={state.positionWords !== false} onWords={(positionWords) => setState({ ...state, positionWords })}
          width={params.width} height={params.height} />
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
            {/* Keyed so each new image remounts and develops in (the hero moment). */}
            <div className="border-border overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={current.id} src={`/api/gallery/${current.file}`} alt="Latest generation" onLoad={developed} onError={developed} className="animate-develop w-full" />
            </div>
            <figcaption className="text-muted flex items-center justify-between text-sm">
              <span className="font-mono text-xs">seed {current.seed}</span>
              <span className="flex gap-4">
                {native
                  ? <button type="button" className="text-accent" onClick={() => (window as unknown as { webkit: { messageHandlers: { studio: { postMessage: (m: unknown) => void } } } }).webkit.messageHandlers.studio.postMessage({ save: `/api/gallery/${current.file}` })}>Save</button>
                  : <a className="text-accent" href={`/api/gallery/${current.file}`} download={current.file}>Save</a>}
                <button type="button" className="text-accent" onClick={() => reuse(current)}>Reuse recipe</button>
              </span>
            </figcaption>
          </figure>
        ) : <div className="border-border text-muted grid aspect-[832/1216] place-items-center rounded-lg border">Nothing yet</div>}
        <HistoryStrip items={history} onOpen={setCurrent} />
      </section>

      <div className="bg-bg/90 border-border fixed inset-x-0 bottom-0 border-t p-3 backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {undo ? <p role="status" className="flex flex-1 items-center gap-3 text-sm">Prompt recreated
              <button type="button" onClick={() => { setState(undo); setUndo(null); }} className="text-accent font-semibold">Undo</button></p>
            : note ? <p role="status" className="text-ok flex-1 text-sm">{note}</p>
            : error ? <p role="alert" className="text-danger flex-1 text-sm">{error}</p>
            : <span className="text-faint hidden truncate font-mono text-[11px] sm:inline">{params.width}×{params.height} · {params.steps} steps · {isFree(params) ? "free" : "Anlas"}</span>}
          <button type="button" onClick={() => setGrid(true)} className="border-border ml-auto rounded-lg border px-4 py-3 text-base">Grid</button>
          <button type="button" onClick={() => setChat(true)} className="border-border rounded-lg border px-4 py-3 text-base">Chat</button>
          <button type="button" onClick={generate} disabled={busy} aria-busy={busy}
            className={`bg-accent text-accent-fg rounded-lg px-6 py-3 text-base font-semibold ${busy ? "sweep" : ""}`}>
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
      <BlockDrawer open={drawer} onClose={() => setDrawer(false)} chars={state.chars} tagText={tagText}
        onSend={sendBlocks} onLoadScene={(b) => { setState(loadScene(b)); setDrawer(false); }}
        preset={preset} onPreset={setPreset} rating={state.rating} />
      <ChatSheet open={chat} onClose={() => setChat(false)} state={state} seed={seed}
        onApply={(ops) => setState((s) => applyOps(s, ops))} />
      <FindSheet open={find} onClose={() => setFind(false)} rating={state.rating} onRecreate={doRecreate} />
      <GridSheet open={grid} onClose={() => setGrid(false)} state={state} params={params} onApply={setState} onDone={loadHistory} />
    </main>
  );
}
