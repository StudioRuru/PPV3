"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoRecipe, VideoRecipe } from "@/lib/comfy/recipe";
import type { Item } from "@/lib/comfy/store";
import { requestJson } from "@/lib/net";
import type { Generation } from "../HistoryStrip";
import { toDataUrl } from "./PoseEditor";

const url = (f: string) => `/api/comfy/file/${f}`;
const short = (n: string) => n.replace(/\.safetensors$/, "");
const row = "flex justify-between gap-3 text-xs";

type Src = "all" | "comfy" | "nai";
const SRCS: [Src, string][] = [["all", "All"], ["comfy", "ComfyUI"], ["nai", "NovelAI"]];
type Tile = { t: number; it: Item; g?: undefined } | { t: number; g: Generation; it?: undefined };

/**
 * Library sub-tab: ComfyUI items and NovelAI images in one newest-first grid. Tap for its recipe, Reuse, Animate this and Delete;
 * a NovelAI image is copied into the ComfyUI Library (once) when it's animated or picked for ComfyUI. Import adds phone photos.
 */
export function LibraryPane({ onReuse, onAnimate }: { onReuse: (it: Item) => void; onAnimate: (it: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [armed, setArmed] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const busy = useRef(false);
  const [src, setSrc] = useState<Src>("all");
  const [nai, setNai] = useState<Generation[]>([]);
  const [openNai, setOpenNai] = useState<Generation | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const load = useCallback(async (before?: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const r = await requestJson<{ items: Item[] }>(`/api/comfy/items${before ? `?before=${before}` : ""}`);
    busy.current = false;
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setItems((x) => [...x, ...r.data.items]);
    setMore(r.data.items.length >= 50);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { requestJson<{ items: Generation[] }>("/api/generations?limit=1000").then((r) => r.ok && setNai(r.data.items)); }, []);

  const post = (body: object) => requestJson<{ item: Item }>("/api/comfy/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const added = (it: Item) => setItems((x) => (x.some((i) => i.id === it.id) ? x : [it, ...x]));
  const importFiles = async (files: File[]) => {
    for (const [n, f] of files.entries()) {
      setImporting(`Importing ${n + 1} of ${files.length}…`);
      const r = await post({ image: await toDataUrl(f).catch(() => null) });
      if (!r.ok) { setImporting(null); return setError(`${f.name}: ${r.error}`); }
      added(r.data.item);
    }
    setImporting(null); setError(null);
  };
  /** NovelAI image → its ComfyUI Library copy (made on first use). */
  const adopt = async (g: Generation, then?: (it: Item) => void) => {
    const r = await post({ generation: g.id });
    if (!r.ok) return setDelError(r.error);
    added(r.data.item);
    closeNai();
    then?.(r.data.item);
  };
  const closeNai = () => { setOpenNai(null); setDelError(null); };
  const adopted = new Set(items.map((i) => (i.recipe as { generation?: number } | null)?.generation));
  const oldest = items.length ? items[items.length - 1].createdAt : Infinity;
  const tiles: Tile[] = [
    ...(src === "nai" ? [] : items.map((it) => ({ t: it.createdAt, it }))),
    // NovelAI images past the last loaded ComfyUI page wait for Load more, so the merged order never jumps
    ...(src === "comfy" ? [] : nai.filter((g) => src === "nai" || (!adopted.has(g.id) && (!more || (g.created_at ?? 0) >= oldest))).map((g) => ({ t: g.created_at ?? 0, g }))),
  ].sort((a, b) => b.t - a.t);

  const close = () => { setOpen(null); setArmed(false); setDelError(null); };
  useEffect(() => {
    if (!open && !openNai) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); closeNai(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, openNai]);
  const del = async (it: Item) => {
    if (!armed) return setArmed(true);
    const r = await requestJson<{ ok: true }>(`/api/comfy/items?id=${it.id}`, { method: "DELETE" });
    if (!r.ok && !/not found/i.test(r.error)) { setArmed(false); return setDelError(r.error); }
    setItems((x) => x.filter((i) => i.id !== it.id));
    close();
  };

  const rec = (open?.recipe ?? undefined) as (Partial<PhotoRecipe> & Partial<VideoRecipe>) | undefined;
  const btn = "min-h-11 rounded-full border px-4 text-sm";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {SRCS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={src === k} onClick={() => setSrc(k)}
            className={`h-9 rounded-full border px-3 text-sm ${src === k ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`}>{label}</button>
        ))}
        <label className="border-border ml-auto grid h-9 cursor-pointer place-items-center rounded-full border px-3 text-sm">
          {importing ?? "Import"}
          <input type="file" accept="image/*" multiple disabled={!!importing} className="sr-only"
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void importFiles(f); }} />
        </label>
      </div>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {tiles.length === 0 && !loading && !error && (
        <div className="border-border text-muted grid min-h-48 place-items-center rounded-lg border p-6 text-center text-sm">Your photos and clips will appear here.</div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map(({ it, g }) => g ? (
          <button key={`n${g.id}`} type="button" aria-label={`Open NovelAI image ${g.id}`} onClick={() => setOpenNai(g)} className="border-border bg-surface relative aspect-square overflow-hidden rounded-md border">
            <img src={`/api/gallery/${g.file}?w=256`} alt="" loading="lazy" className="size-full object-cover" />
            <span aria-hidden className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">NAI</span>
          </button>
        ) : (
          <button key={it.id} type="button" aria-label={`Open ${it.kind} ${it.id}`} onClick={() => setOpen(it)} className="border-border bg-surface relative aspect-square overflow-hidden rounded-md border">
            {it.kind === "clip" && !it.poster
              ? <span aria-hidden className="text-faint grid size-full place-items-center text-2xl">▶</span>
              : <img src={url(it.kind === "clip" ? it.poster! : it.file)} alt="" loading="lazy" className="size-full object-cover" />}
            {it.kind === "clip" && it.poster && <span aria-hidden className="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 text-xs text-white">▶</span>}
          </button>
        ))}
      </div>
      {more && items.length > 0 && src !== "nai" && (
        <button type="button" disabled={loading} onClick={() => void load(items[items.length - 1].id)} className={`${btn} border-border text-muted w-full`}>{loading ? "Loading…" : "Load more"}</button>
      )}
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${open.kind} ${open.id}`} className="bg-bg fixed inset-0 z-50 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto max-w-md space-y-3">
            <button type="button" onClick={close} className={`${btn} border-border text-muted`}>Close</button>
            {open.kind === "clip"
              ? <video key={open.file} src={url(open.file)} poster={open.poster ? url(open.poster) : undefined} playsInline loop muted autoPlay controls className="bg-surface w-full rounded-lg" />
              : <img src={url(open.file)} alt="" className="bg-surface w-full rounded-lg" />}
            {rec && <dl className="border-border bg-surface space-y-1 rounded-lg border p-3">
              {rec.model && <div className={row}><dt className="text-muted">Model</dt><dd className="truncate">{short(rec.model)}</dd></div>}
              {rec.mode && <div className={row}><dt className="text-muted">Mode</dt><dd>{rec.mode}</dd></div>}
              <div className={row}><dt className="text-muted">Seed</dt><dd>{open.seed}</dd></div>
              {rec.width && <div className={row}><dt className="text-muted">Size</dt><dd>{rec.width}×{rec.height}</dd></div>}
              {rec.size && <div className={row}><dt className="text-muted">Clip</dt><dd>{rec.seconds} s · {rec.size} · {rec.fps} fps · {rec.motion}</dd></div>}
              {rec.steps != null && <div className={row}><dt className="text-muted">Steps · CFG</dt><dd>{rec.steps} · {rec.cfg}{rec.sampler ? ` · ${rec.sampler}/${rec.scheduler}` : ""}</dd></div>}
              {rec.start != null && <div className={row}><dt className="text-muted">Start frame</dt><dd>#{rec.start}</dd></div>}
              {!!rec.loras?.length && <div className={row}><dt className="text-muted">LoRAs</dt><dd className="text-right">{rec.loras.map((l) => `${short(l.name)} ${l.strength}`).join(", ")}</dd></div>}
            </dl>}
            {rec?.pose && <img src={url(rec.pose.image)} alt={`${rec.pose.kind} reference`} onError={(e) => { e.currentTarget.hidden = true; }} className="border-border h-24 rounded-md border" />}
            {rec?.prompt && <p className="text-muted text-xs break-words whitespace-pre-wrap">{rec.prompt}</p>}
            {delError && <p role="alert" className="text-danger text-sm">{delError}</p>}
            <div className="flex flex-wrap gap-2">
              {rec?.mode && <button type="button" onClick={() => { onReuse(open); close(); }} className={`${btn} bg-accent text-accent-fg border-accent font-semibold`}>Reuse</button>}
              {open.kind === "photo" && <button type="button" onClick={() => { onAnimate(open); close(); }} className={`${btn} border-border`}>Animate this</button>}
              <button type="button" onClick={() => void del(open)} onBlur={() => setArmed(false)} className={`${btn} border-danger text-danger ml-auto`}>{armed ? "Tap again to delete" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
      {openNai && (
        <div role="dialog" aria-modal="true" aria-label={`NovelAI image ${openNai.id}`} className="bg-bg fixed inset-0 z-50 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto max-w-md space-y-3">
            <button type="button" onClick={closeNai} className={`${btn} border-border text-muted`}>Close</button>
            <img src={`/api/gallery/${openNai.file}`} alt="" className="bg-surface w-full rounded-lg" />
            <dl className="border-border bg-surface space-y-1 rounded-lg border p-3">
              <div className={row}><dt className="text-muted">From</dt><dd>NovelAI · {openNai.model}</dd></div>
              <div className={row}><dt className="text-muted">Seed</dt><dd>{openNai.seed}</dd></div>
            </dl>
            {delError && <p role="alert" className="text-danger text-sm">{delError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void adopt(openNai, onAnimate)} className={`${btn} bg-accent text-accent-fg border-accent font-semibold`}>Animate this</button>
              <button type="button" onClick={() => void adopt(openNai)} className={`${btn} border-border`}>Use in ComfyUI</button>
            </div>
            <p className="text-faint text-xs">“Use in ComfyUI” puts a copy in the ComfyUI Library, so it shows up in Swap head and as a start frame. Delete NovelAI images in the Camera Roll.</p>
          </div>
        </div>
      )}
    </>
  );
}
