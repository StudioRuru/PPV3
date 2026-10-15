"use client";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { developed, mb, type Generation } from "./HistoryStrip";
import { Sheet } from "./Sheet";
import { Trash } from "./icons";

type Filter = "all" | "today" | "upscaled" | "runs" | "rp";
const FILTERS: [Filter, string][] = [["all", "All"], ["today", "Today"], ["upscaled", "Upscaled"], ["runs", "Grid & variations"], ["rp", "RP"]];
type RpImage = { id: number; file: string; prompt: string; character: string | null };

const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const pass = (g: Generation & { grid_id?: string | null }, f: Filter) =>
  f === "all" || (f === "today" && (g.created_at ?? 0) >= midnight()) || (f === "upscaled" && !!g.params.upscaled)
  || (f === "runs" && !!g.grid_id && !g.params.upscaled);

/** Every generation in a grid: filter, select, zip to Files, delete — plus the auto-delete window. */
export function CameraRoll({ active, onOpen, onChanged }: {
  active: boolean; onOpen: (items: Generation[], id: number) => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<(Generation & { grid_id?: string | null })[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [confirm, setConfirm] = useState<"selected" | "all" | null>(null);
  const [retention, setRetention] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rpImages, setRpImages] = useState<RpImage[]>([]);

  const load = useCallback(async () => {
    const r = await requestJson<{ items: Generation[] }>("/api/generations?limit=1000");
    if (r.ok) setItems(r.data.items);
    const s = await requestJson<{ autoDeleteDays: number | null }>("/api/settings");
    if (s.ok) setRetention(s.data.autoDeleteDays);
    const rp = await requestJson<{ images: RpImage[] }>("/api/rp/images");
    if (rp.ok) setRpImages(rp.data.images);
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const shown = items.filter((g) => pass(g, filter));
  const bytes = (list: Generation[]) => list.reduce((n, g) => n + (g.size ?? 0), 0);
  const sel = shown.filter((g) => picked.includes(g.id));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function zip(list: Generation[]) {
    // iOS shell turns this download into a share sheet (Save to Files / iCloud Drive); browsers download it.
    const a = document.createElement("a");
    a.href = `/api/export?ids=${list.map((g) => g.id).join(",")}`; a.download = ""; a.click();
  }

  async function remove(which: "selected" | "all") {
    const r = await requestJson<{ deleted: number }>("/api/generations", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      // Exactly the images that were counted in the dialog — never rows the roll hasn't shown (new or past the limit).
      body: JSON.stringify({ ids: (which === "all" ? items : sel).map((g) => g.id) }),
    });
    setConfirm(null);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setPicked([]); setSelecting(false);
    await load(); onChanged();
  }

  return (
    <section aria-label="Camera roll" className={`space-y-3 ${selecting ? "pb-[calc(env(safe-area-inset-bottom)+5rem)]" : ""}`}>
      <header className="flex items-end gap-2">
        <div className="flex-1">
          <h1 className="text-[15px] font-semibold tracking-wide">Camera roll</h1>
          <p className="text-muted font-mono text-[11px]">
            {items.length} images · {mb(bytes(items)) || "0 MB"} · auto-delete {retention ? `${retention} day${retention > 1 ? "s" : ""}` : "off"}
          </p>
        </div>
        {filter !== "rp" && <button type="button" onClick={() => { setSelecting(!selecting); setPicked([]); }} className="text-accent h-11 px-2 text-sm">{selecting ? "Done" : "Select"}</button>}
      </header>

      <div data-noswipe className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); if (f === "rp") { setSelecting(false); setPicked([]); } }}
            className={`h-9 shrink-0 rounded-full px-3.5 text-sm ${filter === f ? "bg-fg text-bg font-semibold" : "border-border text-muted border"}`}>
            {label} <span className="font-mono text-[11px] opacity-70">{f === "rp" ? rpImages.length : items.filter((g) => pass(g, f)).length}</span>
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {/* RP images (from roleplay chats) are view-only here: never selected, zipped, deleted or auto-deleted by the roll. */}
      {filter === "rp" ? (
        <div className="grid grid-cols-3 gap-1 lg:grid-cols-6">
          {!rpImages.length && <p className="text-muted col-span-full py-10 text-center text-sm">No roleplay images.</p>}
          {rpImages.map((g) => (
            <a key={g.id} href={`/api/rp/files/images/${g.file}`} target="_blank" rel="noreferrer" data-noswipe title={g.prompt} className="relative overflow-hidden rounded-md bg-black/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/rp/files/images/${g.file}`} alt={g.character ? `From a chat with ${g.character}` : ""} loading="lazy" className="aspect-square w-full object-cover" />
              {g.character && <span className="absolute inset-x-1 bottom-1 truncate font-mono text-[9px] text-white drop-shadow">{g.character}</span>}
            </a>
          ))}
        </div>
      ) : <>
      {!shown.length && <p className="text-muted py-10 text-center text-sm">No images here yet.</p>}

      <div className="grid grid-cols-3 gap-1 lg:grid-cols-6">
        {shown.map((g) => {
          const on = picked.includes(g.id);
          return (
            <button key={g.id} type="button" data-noswipe aria-pressed={selecting ? on : undefined}
              aria-label={selecting ? `Select image ${g.id}` : `Open image ${g.id}`}
              onClick={() => (selecting ? toggle(g.id) : onOpen(shown, g.id))}
              className="relative overflow-hidden rounded-md bg-black/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/gallery/${g.file}?w=256`} alt="" loading="lazy" onLoad={developed} onError={developed}
                className={`animate-develop aspect-square w-full object-cover transition-opacity ${selecting && !on ? "opacity-70" : ""}`} />
              <span className="absolute inset-x-1 bottom-1 flex justify-between font-mono text-[9px] text-white drop-shadow">
                <span>{g.params.upscaled ? `${g.params.upscaled}×` : ""}</span><span>{mb(g.size)}</span>
              </span>
              {selecting && (
                <span aria-hidden="true" className={`absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full border-2 text-xs ${on ? "bg-accent text-accent-fg border-transparent" : "border-white/80 bg-black/30"}`}>{on ? "✓" : ""}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection bar floats above the tab bar. */}
      {selecting && (
        <div className="bg-surface border-border fixed inset-x-3 z-30 flex items-center gap-2 rounded-xl border p-2 shadow-xl" style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}>
          <span className="text-muted flex-1 px-1 font-mono text-xs">{sel.length} selected{sel.length ? ` · ${mb(bytes(sel))}` : ""}</span>
          <button type="button" onClick={() => setPicked(sel.length === shown.length ? [] : shown.map((g) => g.id))} className="text-accent h-10 px-2 text-sm">{sel.length === shown.length && shown.length ? "None" : "All"}</button>
          <button type="button" disabled={!sel.length} onClick={() => zip(sel)} className="bg-accent text-accent-fg h-10 rounded-lg px-3 text-sm font-semibold disabled:opacity-40">Zip to Files</button>
          <button type="button" disabled={!sel.length} onClick={() => setConfirm("selected")} aria-label="Delete selected" className="text-danger grid size-10 place-items-center disabled:opacity-40"><Trash className="size-5" /></button>
        </div>
      )}
      </>}
      {!selecting && filter !== "rp" && items.length > 0 && (
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={() => zip(shown)} className="border-border flex-1 rounded-lg border px-3 py-2.5 text-sm">Zip {filter === "all" ? "everything" : "these"} · {shown.length}</button>
          <button type="button" onClick={() => setConfirm("all")} className="border-danger/40 text-danger rounded-lg border px-3 py-2.5 text-sm">Clear all</button>
        </div>
      )}

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} label="Confirm delete" closeLabel="Cancel delete" className="rounded-t-2xl border-t lg:max-w-md lg:rounded-none lg:border-l">
        <header className="p-3"><h2 className="text-base font-semibold">{confirm === "all" ? `Delete all ${items.length} images in the roll?` : `Delete ${sel.length} image${sel.length === 1 ? "" : "s"}?`}</h2></header>
        <p className="text-muted px-3 text-sm">This removes them from the Mac for good{confirm === "all" ? ` (${mb(bytes(items))})` : ""}. Zip them first if you want a copy.</p>
        <div className="flex gap-2 p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <button type="button" onClick={() => setConfirm(null)} className="border-border flex-1 rounded-lg border px-4 py-3">Cancel</button>
          <button type="button" onClick={() => confirm && remove(confirm)} className="bg-danger flex-1 rounded-lg px-4 py-3 font-semibold text-white">Delete</button>
        </div>
      </Sheet>
    </section>
  );
}

