"use client";
import { useState } from "react";
import type { Surface, Tier } from "@/lib/sprites/core";
import { requestJson } from "@/lib/net";
import type { CellView } from "./grid";
import { Chip, Clip, TakesSheet, shown } from "./TakesSheet";
import type { Ensure, Inv } from "./SpritesScreen";

type LibItem = { id: number; kind: "photo" | "clip"; file: string; poster: string | null };
const BASE = "@base";
const btn = "min-h-11 rounded-full border px-4 text-sm disabled:opacity-50";
const field = "border-border bg-surface h-11 rounded-md border px-3 text-sm";

/** The base for this surface+outfit, then its endpoints (one still per expression/pose). */
export function BasesView({ surface, outfit, inv, run, onAct, ensure }: {
  surface: Surface; outfit: string; inv: Inv; run: (url: string, body: object) => Promise<boolean>; onAct: (cellId: number, body: object) => Promise<void>; ensure: Ensure;
}) {
  const [picking, setPicking] = useState<LibItem[] | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [src, setSrc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const [tier, setTier] = useState<Tier>("tame");

  const find = (k: string): CellView | undefined => inv.cells.find((c) => c.surface === surface && c.outfit === outfit && c.from === k && c.to === "");
  const base = find(BASE);
  const baseOk = base?.status === "approved";
  const open = openId == null ? null : inv.cells.find((c) => c.id === openId) ?? null;
  const keys = inv.allowed(surface, outfit);
  const opts = (["chat", "stage"] as const).flatMap((s) => inv.outfits.map((o) => ({ v: `${s}:${o.key}`, t: `${s === "chat" ? "Chat" : "Stage"} · ${o.label}` })))
    .filter((o) => o.v !== `${surface}:${outfit}` && inv.cells.some((c) => `${c.surface}:${c.outfit}` === o.v && c.from === BASE && c.to === "" && c.status === "approved")); // derive copies an approved base

  const openPicker = async () => {
    setPicking([]);
    const r = await requestJson<{ items: LibItem[] }>("/api/comfy/items");
    setPicking(r.ok ? r.data.items.filter((i) => i.kind === "photo") : []);
  };
  const pick = async (i: LibItem) => { setPicking(null); await run("/api/sprites/base", { surface, outfit, itemId: i.id }); };
  const derive = async () => {
    const [s, o] = src.split(":");
    if (await run("/api/sprites/base", { surface, outfit, derive: { surface: s, outfit: o, prompt } })) { setDeriving(false); setPrompt(""); }
  };
  const addKey = async () => {
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (key && await run("/api/sprites/inventory", { op: "add-key", surface, key, label: label.trim(), prompt: desc.trim() || label.trim(), tier, tags: tier === "tame" ? [] : ["adult"] })) { setLabel(""); setDesc(""); }
  };
  return (
    <div className="space-y-4">
      <section className="border-border bg-surface space-y-3 rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Base</h2>
        <div className="flex flex-wrap items-start gap-3">
          <div className="bg-bg aspect-[4/7] w-32 shrink-0 overflow-hidden rounded">{base && shown(base) ? <Clip t={shown(base)!} className="size-full object-cover" /> : <span className="text-faint grid size-full place-items-center p-2 text-center text-xs">No base yet</span>}</div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2"><Chip s={base?.status ?? "empty"} />{base && base.takes.some((t) => t.file) && <button type="button" onClick={() => setOpenId(base.id)} className={`${btn} border-border text-muted`}>Review takes</button>}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void openPicker()} className={`${btn} border-accent text-accent-ink`}>Pick from Library</button>
              {opts.length > 0 && <button type="button" onClick={() => { setDeriving((d) => !d); setSrc(opts[0]?.v ?? ""); }} className={`${btn} border-border text-muted`}>Derive from…</button>}
            </div>
            {opts.length === 0 && !baseOk && <p className="text-muted text-xs">Start with a photo from the Library. Once one base is approved, others can be derived from it.</p>}
            {deriving && (
              <form onSubmit={(e) => { e.preventDefault(); void derive(); }} className="flex flex-wrap gap-2">
                <select aria-label="Derive from" value={src} onChange={(e) => setSrc(e.target.value)} className={field}>{opts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="What changes" placeholder="What changes (e.g. full body, night outfit)" className={`${field} min-w-0 basis-full`} />
                <button type="submit" disabled={!prompt.trim() || !src} className={`${btn} border-accent text-accent-ink`}>Make 3 takes</button>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Endpoints</h2>
        {!baseOk && <p className="text-muted text-sm">Approve a base first — endpoints are made from it.</p>}
        <ul className="grid gap-2 lg:grid-cols-2">
          {keys.map((k) => {
            const c = find(k.key);
            const t = c && shown(c);
            return (
              <li key={k.key} className="border-border bg-surface flex items-center gap-3 rounded-lg border p-2">
                <div className="bg-bg h-20 w-12 shrink-0 overflow-hidden rounded">{t ? <Clip t={t} className="size-full object-cover" /> : null}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{k.label}</p><p className="text-faint text-xs">{k.tier}{c && c.takes.length ? ` · ${c.takes.filter((x) => x.file).length} takes` : ""}</p></div>
                <Chip s={c?.status ?? "empty"} />
                {c && c.takes.some((x) => x.file) && <button type="button" onClick={() => setOpenId(c.id)} className={`${btn} border-border text-muted`}>Review</button>}
                {(!c || c.status === "empty" || c.status === "rejected") && <button type="button" disabled={!baseOk} onClick={async () => { const id = c?.id ?? await ensure(surface, outfit, k.key); if (id != null) await onAct(id, { op: "generate", n: 3 }); }} className={`${btn} border-accent text-accent-ink`}>Generate</button>}
              </li>
            );
          })}
        </ul>
      </section>

      <form onSubmit={(e) => { e.preventDefault(); void addKey(); }} className="border-border bg-surface flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <h2 className="w-full text-sm font-semibold">Add {surface === "chat" ? "expression" : "pose"}</h2>
        <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" placeholder="Label" className={`${field} w-36`} />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" placeholder="Description (what the picture shows)" className={`${field} min-w-0 flex-1`} />
        <select aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)} className={field}><option value="tame">Tame</option><option value="teasing">Teasing</option><option value="lewd">Lewd</option></select>
        <button type="submit" disabled={!label.trim()} className={`${btn} border-accent text-accent-ink`}>Add</button>
      </form>

      {picking && (
        <div role="dialog" aria-modal="true" aria-label="Pick from Library" className="bg-bg fixed inset-0 z-50 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-3">
            <button type="button" onClick={() => setPicking(null)} className={`${btn} border-border text-muted`}>Close</button>
            {picking.length === 0 ? <p className="text-muted text-sm">No photos in the Library yet.</p>
              : <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">{picking.map((i) => (
                <button key={i.id} type="button" aria-label={`Pick photo ${i.id}`} onClick={() => void pick(i)} className="border-border aspect-square overflow-hidden rounded-md border"><img src={`/api/comfy/file/${i.file}`} alt="" loading="lazy" className="size-full object-cover" /></button>
              ))}</div>}
          </div>
        </div>
      )}
      {open && <TakesSheet cell={open} title={open.from === BASE ? "Base" : keys.find((k) => k.key === open.from)?.label ?? open.from} onClose={() => setOpenId(null)} onAct={onAct} />}
    </div>
  );
}
