"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlockDrawer } from "@/components/BlockDrawer";
import { ChatSheet, type ChatSeed } from "@/components/ChatSheet";
import { CharacterBoxes } from "@/components/CharacterBoxes";
import { FindSheet } from "@/components/FindSheet";
import { CameraRoll } from "@/components/CameraRoll";
import { SaveFlash } from "@/components/SaveFlash";
import { TabBar, type Tab } from "@/components/TabBar";
import { NO_SWIPE, swipeDirection } from "@/lib/swipe";
import { GridSheet } from "@/components/GridSheet";
import { Viewer } from "@/components/Viewer";
import { loadDefaults, SettingsSheet } from "@/components/SettingsSheet";
import { UpscaleSheet, VariationSheet } from "@/components/VariationSheet";
import { costLabel, developed, HistoryStrip, mb, type Generation } from "@/components/HistoryStrip";
import { LineList } from "@/components/LineList";
import { ParamsBar } from "@/components/ParamsBar";
import { AutoTextarea } from "@/components/TagInput";
import { PosNegTabs, tagCount, type Side } from "@/components/PosNegTabs";
import { TaggerPane } from "@/components/TaggerPane";
import { applyBlock, loadScene, type Block } from "@/lib/blocks";
import { loadDraft, saveDraft } from "@/lib/draft";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { applyOps } from "@/lib/patch";
import { isFree } from "@/lib/grid";
import { canResend, legacyParams } from "@/lib/nai-body";
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
  const [settings, setSettings] = useState(false);
  const [baseSide, setBaseSide] = useState<Side>("pos");
  const [viewing, setViewing] = useState<number | null>(null); // generation id
  const [tab, setTab] = useState<Tab>("studio");
  const [flash, setFlash] = useState<string | null>(null);
  const clearFlash = useCallback(() => setFlash(null), []);
  // The viewer browses whichever list it was opened from (studio history or the camera roll).
  const [viewerItems, setViewerItems] = useState<Generation[] | null>(null);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const TABS: Tab[] = ["studio", "roll", "closet"];
  const [vary, setVary] = useState<Generation | null>(null);
  const [upscale, setUpscale] = useState<Generation | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);

  /** iOS shell: native Save to Photos. Browser: a normal download of the full PNG. */
  function save(g: Generation) {
    const path = `/api/gallery/${encodeURIComponent(g.file)}`;
    if (native) {
      (window as unknown as { webkit: { messageHandlers: { studio: { postMessage: (m: unknown) => void } } } }).webkit.messageHandlers.studio.postMessage({ save: path });
      return;
    }
    const a = document.createElement("a");
    a.href = path; a.download = g.file; a.click();
    setFlash(`Saved${g.size ? ` · ${mb(g.size)}` : ""}`);
  }

  async function showGeneration(id: number) {
    const items = await loadHistory();
    setCurrent(items.find((g) => g.id === id) ?? null);
  }
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
    // Native "Saved to Photos" gets the floppy overlay; anything else is a status line.
    w.studioToast = (msg: string) => (msg.startsWith("Saved") ? setFlash(msg) : setNote(msg));
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);
  const [incoming, setIncoming] = useState<File | null>(null);

  // Undo restores the pre-Recreate prompt only until the user edits the recreated one.
  const recreated = useRef<PromptState | null>(null);
  function doRecreate(tags: RawTag[]) {
    const next = recreate(tags, state);
    recreated.current = next;
    setUndo(state);
    setState(next);
  }
  useEffect(() => { if (undo && state !== recreated.current) setUndo(null); }, [state, undo]);
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
    else setParams({ ...DEFAULT_PARAMS, ...loadDefaults() });
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
    // An upscaled image's recipe is its original size; drop the marker so it's an ordinary draft again.
    const { upscaled: _, ...p } = g.params;
    setParams({ ...DEFAULT_PARAMS, ...legacyParams(p) });
  }

  async function onDrop(file: File) {
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<Pick<Generation, "state" | "params">>("/api/recipe", { method: "POST", body: fd });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    reuse({ state: r.data.state, params: { ...params, ...r.data.params } });
  }

  return (
    <main className={`mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-2 ${tab === "studio" ? "pb-[calc(env(safe-area-inset-bottom)+10rem)]" : "pb-[calc(env(safe-area-inset-bottom)+6rem)]"}`}
      style={{ touchAction: "pan-y" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onDrop(f); }}
      // Swipe left/right on free page areas to change tab; never from controls, the Tagger, the canvas or sheets.
      onPointerDown={(e) => { swipe.current = e.pointerType !== "touch" || (e.target as HTMLElement).closest(NO_SWIPE) ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp }; }}
      onPointerUp={(e) => {
        const s = swipe.current; swipe.current = null;
        if (!s || window.getSelection()?.toString()) return;
        const dir = swipeDirection({ dx: e.clientX - s.x, dy: e.clientY - s.y, ms: e.timeStamp - s.t });
        const i = TABS.indexOf(tab) + (dir === "next" ? 1 : dir === "prev" ? -1 : 0);
        if (dir && TABS[i]) setTab(TABS[i]);
      }}
      onPointerCancel={() => { swipe.current = null; }}>
      {/* Studio stays mounted (hidden) on other tabs so the Tagger and drafts keep their state. */}
      <div className={tab === "studio" ? "contents" : "hidden"}>
      <section className="space-y-4">
        <header className="flex items-center gap-2">
          <h1 className="flex-1 text-[15px] font-semibold tracking-wide">NAI Studio</h1>
          <label className="border-border text-muted flex h-9 cursor-pointer items-center rounded-full border px-3 text-xs">
            Import NovelAI PNG
            <input type="file" accept="image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onDrop(f); }} />
          </label>
          <button type="button" onClick={() => setSettings(true)} aria-label="Settings" className="text-muted grid size-11 place-items-center rounded-full">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
          </button>
        </header>
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
          <header className="mb-2 flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">Base prompt</h2>
            <PosNegTabs side={baseSide} onSide={setBaseSide} pos={state.base.reduce((n, l) => n + tagCount(l.text), 0)} neg={tagCount(state.uc)} />
          </header>
          {baseSide === "pos"
            ? <LineList lines={state.base} onChange={(base) => setState({ ...state, base })} />
            : <AutoTextarea value={state.uc} onChange={(uc) => setState({ ...state, uc })} placeholder="undesired content — the UC preset is added automatically" />}
        </div>
        <div className="bg-surface border-border rounded-lg border p-3">
          <h2 className="mb-0.5 text-sm font-semibold">Artists</h2>
          <p className="text-faint mb-2 text-xs">Sent first in the base prompt. Tap a weight to blend styles; below 0 steers away.</p>
          <LineList lines={state.artists?.length ? state.artists : []} onChange={(artists) => setState({ ...state, artists })}
            placeholder="artist name" addLabel="+ artist" />
        </div>
        <CharacterBoxes chars={state.chars} onChange={(chars) => setState({ ...state, chars })}
          positions={state.positions ?? "ai"} onPositions={(positions) => setState({ ...state, positions })}
          words={state.positionWords === true} onWords={(positionWords) => setState({ ...state, positionWords })}
          width={params.width} height={params.height} />
      </section>

      <section className="space-y-3">
        {current ? (
          <figure className="space-y-2">
            {/* Keyed so each new image remounts and develops in (the hero moment). */}
            <button type="button" onClick={() => setViewing(current.id)}
              aria-label="Open full screen" className="border-border block w-full overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={current.id} src={`/api/gallery/${current.file}`} alt="Latest generation" onLoad={developed} onError={developed} className="animate-develop w-full" />
            </button>
            <figcaption className="text-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <span className="font-mono text-xs">{[`seed ${current.seed}`, mb(current.size), costLabel(current.cost)].filter(Boolean).join(" · ")}</span>
              <span className="flex gap-4">
                <button type="button" className="text-accent" onClick={() => save(current)}>Save</button>
                {canResend(current.params) && <>
                  <button type="button" className="text-accent" onClick={() => setVary(current)}>Variations</button>
                  <button type="button" className="text-accent" onClick={() => setUpscale(current)}>Upscale</button>
                </>}
                <button type="button" className="text-accent" onClick={() => reuse(current)}>Reuse</button>
              </span>
            </figcaption>
          </figure>
        ) : <div className="border-border text-muted grid aspect-[832/1216] place-items-center rounded-lg border">Nothing yet</div>}
        <div className="flex items-center justify-between">
          <h2 className="text-muted text-xs font-medium tracking-wide uppercase">History</h2>
          {history.length > 0 && <button type="button" onClick={() => setTab("roll")} className="text-accent px-1 py-2 text-sm">Camera roll ›</button>}
        </div>
        <div data-noswipe><HistoryStrip items={history} onOpen={setCurrent} /></div>
      </section>
      </div>

      <div className={tab === "roll" ? "lg:col-span-2" : "hidden"}>
        <CameraRoll active={tab === "roll"} onOpen={(items, id) => { setViewerItems(items); setViewing(id); }} onChanged={() => loadHistory().then((items) => setCurrent((c) => items.find((g) => g.id === c?.id) ?? items[0] ?? null))} />
      </div>
      <section aria-label="Closet" className={tab === "closet" ? "lg:col-span-2 space-y-3" : "hidden"}>
        <h1 className="text-[15px] font-semibold tracking-wide">Closet</h1>
        <p className="text-muted text-sm">The workshop for scenes, arcs, outfits and clusters is coming next. Your library is in Building blocks for now.</p>
        <button type="button" onClick={() => setDrawer(true)} className="border-border rounded-lg border px-4 py-3 text-sm">Open Building blocks</button>
      </section>

      <div className={`bg-bg/90 border-border fixed inset-x-0 z-20 border-t px-3 py-2 backdrop-blur ${tab === "studio" ? "" : "hidden"}`} style={{ bottom: "calc(env(safe-area-inset-bottom) + 3.5rem)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {undo ? <p role="status" className="flex flex-1 items-center gap-3 text-sm">Prompt recreated
              <button type="button" onClick={() => { setState(undo); setUndo(null); }} className="text-accent font-semibold">Undo</button></p>
            : note ? <p role="status" className="text-ok flex-1 text-sm">{note}</p>
            : error ? <p role="alert" className="text-danger flex-1 text-sm">{error}</p>
            : <span className="text-faint hidden truncate font-mono text-[11px] sm:inline">{params.width}×{params.height} · {params.steps} steps · {isFree(params) ? "free" : "Anlas"}</span>}
          <button type="button" onClick={() => setGrid(true)} className="border-border ml-auto rounded-lg border px-4 py-3 text-base">Grid</button>
          <button type="button" onClick={generate} disabled={busy} aria-busy={busy}
            className={`bg-accent text-accent-fg rounded-lg px-6 py-3 text-base font-semibold ${busy ? "sweep" : ""}`}>
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
      <BlockDrawer open={drawer} onClose={() => setDrawer(false)} chars={state.chars} tagText={tagText}
        onSend={sendBlocks} onLoadScene={(b) => { setState(loadScene(b, state.rating)); setDrawer(false); }}
        preset={preset} onPreset={setPreset} rating={state.rating} />
      <ChatSheet open={chat} onClose={() => setChat(false)} state={state} seed={seed}
        onApply={(ops) => setState((s) => applyOps(s, ops))} />
      <FindSheet open={find} onClose={() => setFind(false)} rating={state.rating} onRecreate={doRecreate} />
      <VariationSheet source={vary} onClose={() => setVary(null)} onPick={showGeneration} onDone={loadHistory} />
      <UpscaleSheet source={upscale} onClose={() => setUpscale(null)} onDone={showGeneration} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} params={params} onParams={setParams}
        words={state.positionWords === true} onWords={(positionWords) => setState((s) => ({ ...s, positionWords }))} />
      <TabBar tab={tab} onTab={setTab} onChat={() => setChat(true)} />
      <SaveFlash text={flash} onDone={clearFlash} />
      <Viewer items={viewerItems ?? (history.some((h) => h.id === current?.id) || !current ? history : [current, ...history])} id={viewing} onId={setViewing} onClose={() => { closeViewer(); setViewerItems(null); }} onSave={save}
        onVary={(g) => { setViewing(null); setVary(g); }} onUpscale={(g) => { setViewing(null); setUpscale(g); }}
        onReuse={(g) => { setViewing(null); setCurrent(g); reuse(g); setTab("studio"); }} />
      <GridSheet open={grid} onClose={() => setGrid(false)} state={state} params={params} onApply={setState} onDone={loadHistory} />
    </main>
  );
}
