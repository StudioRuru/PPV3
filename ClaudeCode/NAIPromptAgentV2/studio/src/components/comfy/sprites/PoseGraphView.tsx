"use client";
import { useMemo, useState } from "react";
import type { SpriteKey, Tier } from "@/lib/sprites/core";
import { requestJson } from "@/lib/net";
import { Chip, Clip, shown } from "./TakesSheet";
import { circleLayout } from "./layout";
import type { Ensure, Inv } from "./SpritesScreen";

type Est = { jobs: number; seconds: number; usd: number };
const W = 600, H = 520, R = 26;
const TAGS = ["tease", "rest", "lewd", "reaction"];
const btn = "min-h-11 rounded-full border px-4 text-sm disabled:opacity-50";
const field = "border-border bg-surface h-11 rounded-md border px-3 text-sm";
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/** Stage pose graph: drag node to node toggles an edge, click an edge removes it; side panel edits the selected pose. */
export function PoseGraphView({ outfit, inv, run, onAct, ensure, onChange }: {
  outfit: string; inv: Inv; run: (url: string, body: object) => Promise<boolean>; onAct: (cellId: number, body: object) => Promise<void>; ensure: Ensure; onChange: () => void;
}) {
  const keys = inv.allowed("stage", outfit);
  const pos = useMemo(() => circleLayout(keys.map((k) => k.key), W, H), [keys]);
  const [sel, setSel] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const cur = keys.find((k) => k.key === sel) ?? null;
  const edge = (a: string, b: string) => inv.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const toggle = (a: string, b: string) => run("/api/sprites/inventory", { op: "edge", a, b, on: !edge(a, b) });
  const endpoint = (k: string) => inv.cells.find((c) => c.surface === "stage" && c.outfit === outfit && c.from === k && c.to === "");
  const shown_ = Object.keys(pos);

  const up = (e: React.PointerEvent) => {
    const a = from; setFrom(null);
    if (!a) return;
    const b = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]") as HTMLElement | null)?.dataset.node;
    if (!b || b === a) setSel(a); else if (pos[b]) void toggle(a, b);
  };
  const add = async () => {
    const key = slug(label);
    if (key && await run("/api/sprites/inventory", { op: "add-key", surface: "stage", key, label: label.trim(), prompt: desc.trim() || label.trim(), tier: "tame", tags: [] })) { setLabel(""); setDesc(""); setSel(key); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pose graph" onPointerUp={up} onPointerCancel={() => setFrom(null)} onPointerLeave={() => setFrom(null)} onPointerDown={() => setFrom(null)} className="border-border bg-surface w-full touch-none rounded-lg border select-none">
          {inv.edges.filter(([a, b]) => pos[a] && pos[b]).map(([a, b]) => (
            <g key={`${a}-${b}`}>
              <line x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="stroke-border" strokeWidth={2} />
              <line x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke="transparent" strokeWidth={18} className="cursor-pointer" role="button" aria-label={`Remove edge ${a} to ${b}`} onClick={() => void toggle(a, b)} />
            </g>
          ))}
          {shown_.map((k) => {
            const c = endpoint(k), t = c && shown(c), p = pos[k];
            return (
              <g key={k} data-node={k} transform={`translate(${p.x},${p.y})`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setFrom(k); }} className="cursor-grab" role="button" aria-label={`Pose ${k}`}>
                <circle r={R} className={from === k || sel === k ? "fill-surface stroke-accent" : "fill-surface stroke-border"} strokeWidth={3} />
                {t && <foreignObject x={-R + 3} y={-R + 3} width={2 * R - 6} height={2 * R - 6} pointerEvents="none"><div className="size-full overflow-hidden rounded-full"><Clip t={t} className="size-full object-cover" /></div></foreignObject>}
                <text y={R + 14} textAnchor="middle" className="fill-current text-[11px]" pointerEvents="none">{keys.find((x) => x.key === k)?.label}</text>
              </g>
            );
          })}
        </svg>
        <p className="text-faint text-xs">Drag from one pose to another to connect or disconnect them. Tap a line to remove it.</p>
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="border-border bg-surface flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <h2 className="w-full text-sm font-semibold">Add pose</h2>
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Pose label" placeholder="Label" className={`${field} w-36`} />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Pose description" placeholder="Description (what the picture shows)" className={`${field} min-w-0 flex-1`} />
          <button type="submit" disabled={!slug(label)} className={`${btn} border-accent text-accent-ink`}>Add pose</button>
        </form>
      </div>
      {cur ? <PosePanel key={cur.key} k={cur} outfit={outfit} inv={inv} cell={endpoint(cur.key)} run={run} onAct={onAct} ensure={ensure} onChange={onChange} /> : <p className="text-muted text-sm">Select a pose to edit it.</p>}
    </div>
  );
}

function PosePanel({ k, outfit, inv, cell, run, onAct, ensure, onChange }: {
  k: SpriteKey; outfit: string; inv: Inv; cell?: Inv["cells"][number]; run: (url: string, body: object) => Promise<boolean>; onAct: (cellId: number, body: object) => Promise<void>; ensure: Ensure; onChange: () => void;
}) {
  const [tags, setTags] = useState(k.tags);
  const [tier, setTier] = useState<Tier>(k.tier);
  const [prompt, setPrompt] = useState(k.prompt);
  const [free, setFree] = useState("");
  const [est, setEst] = useState<Est | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (t: string[], ti: Tier, p: string) => run("/api/sprites/inventory", { op: "update-key", surface: "stage", key: k.key, label: k.label, prompt: p, tier: ti, tags: t });
  const flip = (t: string) => { const n = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]; setTags(n); void save(n, tier, prompt); };
  const addFree = () => { const t = slug(free); if (!t || tags.includes(t)) return; const n = [...tags, t]; setTags(n); setFree(""); void save(n, tier, prompt); };
  const baseOk = inv.cells.some((c) => c.surface === "stage" && c.outfit === outfit && c.from === "@base" && c.to === "" && c.status === "approved");
  const call = async (extra: object) => {
    setBusy(true);
    const r = await requestJson<Est>("/api/sprites/bulk", post({ surface: "stage", outfit, scope: "all", key: k.key, ...extra }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return null; }
    setError(null);
    return r.data;
  };
  const go = async () => { if (await call({ confirm: true })) { setEst(null); onChange(); } };
  return (
    <aside className="border-border bg-surface space-y-3 rounded-lg border p-3" aria-label={`Pose ${k.label}`}>
      <h2 className="text-base font-semibold">{k.label}</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tags">
        {[...TAGS, ...tags.filter((t) => !TAGS.includes(t))].map((t) => <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => flip(t)} className={`h-11 rounded-full border px-3 text-sm ${tags.includes(t) ? "border-accent bg-accent text-accent-fg" : "border-border text-muted"}`}>{t}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); addFree(); }} className="flex gap-2">
        <input value={free} onChange={(e) => setFree(e.target.value)} aria-label="New tag" placeholder="Custom tag" className={`${field} min-w-0 flex-1`} />
        <button type="submit" disabled={!slug(free)} className={`${btn} border-border text-muted`}>Add tag</button>
      </form>
      <label className="block text-sm">Tier
        <select value={tier} onChange={(e) => { const t = e.target.value as Tier; setTier(t); void save(tags, t, prompt); }} className={`${field} mt-1 w-full`}><option value="tame">Tame</option><option value="teasing">Teasing</option><option value="lewd">Lewd</option></select>
      </label>
      <label className="block text-sm">Description
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => { if (prompt.trim() && prompt !== k.prompt) void save(tags, tier, prompt); }} rows={3} className="border-border bg-surface mt-1 w-full rounded-md border p-2 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Endpoint</span><Chip s={cell?.status ?? "empty"} />
        {(!cell || cell.status === "empty" || cell.status === "rejected") && <button type="button" disabled={!baseOk} onClick={async () => { const id = cell?.id ?? await ensure("stage", outfit, k.key); if (id != null) await onAct(id, { op: "generate", n: 3 }); }} className={`${btn} border-accent text-accent-ink`}>Generate</button>}
      </div>
      {!baseOk && <p className="text-muted text-sm">Approve a stage base first.</p>}
      <button type="button" disabled={busy} onClick={async () => setEst(await call({}))} className={`${btn} border-accent text-accent-ink`}>Generate missing for this pose</button>
      {est && (est.jobs === 0
        ? <p className="text-muted text-sm">Nothing missing for this pose.</p>
        : <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{est.jobs} clips · ~{(est.seconds / 3600).toFixed(1)} h · ~${est.usd.toFixed(2)}</span>
          <button type="button" disabled={busy} onClick={() => void go()} className={`${btn} bg-accent text-accent-fg border-accent font-semibold`}>Confirm</button>
          <button type="button" onClick={() => setEst(null)} className={`${btn} border-border text-muted`}>Dismiss</button>
        </div>)}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    </aside>
  );
}
