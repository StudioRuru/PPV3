"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SpriteKey, type Surface, allowedKeys } from "@/lib/sprites/core";
import { requestJson } from "@/lib/net";
import { BasesView } from "./BasesView";
import { BulkBar } from "./BulkBar";
import { GridView } from "./GridView";
import { PoseGraphView } from "./PoseGraphView";
import { ReducedCtx, useReducedMotion } from "./TakesSheet";
import type { CellView } from "./grid";

type State = { outfits: { key: string; label: string }[]; keys: SpriteKey[]; edges: [string, string][]; cells: CellView[]; bulk: { queued: number; running: number }; libraryBytes: number };
export type Inv = State & { allowed: (surface: Surface, outfit: string) => SpriteKey[] };
export type Ensure = (surface: Surface, outfit: string, from: string, to?: string) => Promise<number | null>;
export const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type View = "bases" | "grid" | "pose" | "size";
const VIEWS: { id: View; label: string }[] = [{ id: "bases", label: "Bases & endpoints" }, { id: "grid", label: "Grid" }, { id: "pose", label: "Pose graph" }, { id: "size", label: "Library size" }];
const seg = (on: boolean) => `h-11 px-4 text-sm whitespace-nowrap ${on ? "bg-accent text-accent-fg font-semibold" : "text-muted"}`;

/** Sprites sub-tab: pick a view, surface and outfit; polls fast while anything is generating. */
export function SpritesScreen({ active }: { active: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>("bases");
  const [surface, setSurface] = useState<Surface>("chat");
  const [outfit, setOutfit] = useState("day");
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const [adding, setAdding] = useState(false);
  const [newOutfit, setNewOutfit] = useState("");

  const load = useCallback(async () => {
    const r = await requestJson<State>("/api/sprites");
    if (r.ok) { setState(r.data); setError(null); } else setError(r.error);
  }, []);
  const busy = state ? state.bulk.queued + state.bulk.running > 0 || state.cells.some((c) => c.status === "queued" || c.status === "generating") : false;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => { await load(); if (!stop) timer.current = setTimeout(tick, busy ? 4000 : 30000); };
    void tick();
    return () => { stop = true; clearTimeout(timer.current); };
  }, [active, busy, load]);

  /** Runs a mutation, then refreshes; errors show in the banner. */
  const run = async (url: string, body: object) => {
    const r = await requestJson(url, post(body));
    if (!r.ok) setError(r.error); else window.dispatchEvent(new Event("mascot:sprites")); // Chat portraits refetch the library
    await load();
    return r.ok;
  };
  const act = async (cellId: number, body: object) => { await run(`/api/sprites/cells/${cellId}`, body); };

  /** Gets or creates the cell (endpoint when `to` is omitted) and returns its id. */
  const ensure = async (surface: Surface, outfit: string, from: string, to = "") => {
    const r = await requestJson<{ id: number }>("/api/sprites/cells", post({ surface, outfit, from, to }));
    if (!r.ok) { setError(r.error); return null; }
    await load();
    return r.data.id;
  };

  if (!state) return <p className="text-muted text-sm">{error ?? "Loading sprites…"}</p>;
  const inv: Inv = { ...state, allowed: (s, o) => allowedKeys(state.keys.filter((k) => k.surface === s), "lewd", o) };
  const addOutfit = async () => {
    const key = newOutfit.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || !(await run("/api/sprites/inventory", { op: "add-outfit", key, label: newOutfit.trim() }))) return;
    setOutfit(key); setNewOutfit(""); setAdding(false);
  };
  const mb = (state.libraryBytes / 1048576).toFixed(1);
  return (
    <ReducedCtx.Provider value={reduced}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Sprites view" className="border-border flex max-w-full overflow-x-auto rounded-full border">
          {VIEWS.filter((v) => v.id !== "pose" || surface === "stage").map((v) => <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={seg(view === v.id)}>{v.label}</button>)}
        </div>
        <div role="radiogroup" aria-label="Surface" className="border-border flex overflow-hidden rounded-full border">
          {(["chat", "stage"] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={surface === s} onClick={() => { setSurface(s); if (s === "chat" && view === "pose") setView("bases"); }} className={seg(surface === s)}>{s === "chat" ? "Chat" : "Stage"}</button>)}
        </div>
        <select aria-label="Outfit" value={outfit} onChange={(e) => setOutfit(e.target.value)} className="border-border bg-surface h-11 rounded-full border px-3 text-sm">
          {state.outfits.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {adding
          ? <form onSubmit={(e) => { e.preventDefault(); void addOutfit(); }} className="flex gap-2">
            <input autoFocus value={newOutfit} onChange={(e) => setNewOutfit(e.target.value)} aria-label="Outfit name" placeholder="Outfit name" className="border-border bg-surface h-11 w-36 rounded-full border px-3 text-sm" />
            <button type="submit" className="border-accent text-accent-ink h-11 rounded-full border px-4 text-sm">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="border-border text-muted h-11 rounded-full border px-4 text-sm">Cancel</button>
          </form>
          : <button type="button" onClick={() => setAdding(true)} className="border-border text-muted h-11 rounded-full border px-4 text-sm">Add outfit</button>}
      </div>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {view !== "size" && <BulkBar key={`${surface}/${outfit}`} surface={surface} outfit={outfit} bulk={state.bulk} onChange={load} />}
      {view === "bases" && <BasesView surface={surface} outfit={outfit} inv={inv} run={run} onAct={act} ensure={ensure} />}
      {view === "grid" && <GridView surface={surface} outfit={outfit} inv={inv} onAct={act} ensure={ensure} />}
      {view === "pose" && surface === "stage" && <PoseGraphView outfit={outfit} inv={inv} run={run} onAct={act} ensure={ensure} onChange={load} />}
      {view === "size" && <p className="border-border bg-surface rounded-lg border p-4 text-sm">Sprite library: {mb} MB on disk.</p>}
    </div>
    </ReducedCtx.Provider>
  );
}
