"use client";
import { useEffect, useRef, useState } from "react";
import { EXPRESSIONS, type Expression, type Outfit } from "@/lib/mascot/core";
import { DEFAULT_MASCOT_SETTINGS } from "@/lib/mascot/settings";
import { missingCells } from "@/lib/mascot/ui";
import { requestJson } from "@/lib/net";
import { Sheet } from "../Sheet";
import { AutoTextarea } from "../TagInput";
import type { WireSettings } from "./MascotSettings";

type Kind = "bust" | "full";
type Cell = { kind: Kind; expr: Expression };
type Estimate = { anlas: number | null; perImage: number | null; n: number };
type Spent = { before: number | null; after: number | null; cost: number | null };
type Confirm = { outfit: Outfit; cells: Cell[]; n: number; total: number | null; anlas: number | null };

const OUTFITS: Outfit[] = ["day", "night", "lewd"];
const name = (c: Cell) => (c.kind === "full" ? "full" : c.expr);
const label = (c: Cell) => (c.kind === "full" ? "Full sprite" : c.expr);
const studio = <T,>(body: object) => requestJson<T>("/api/mascot/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";
const btn = "border-border rounded-md border px-3 py-2.5 text-sm disabled:opacity-50";

/** Mascot studio: per outfit, tag editors + generate candidates → pick → saved sprite. Every spend needs a confirm tap. */
export function SpriteStudio({ open, onClose, settings, onSave }: {
  open: boolean; onClose: () => void; settings: WireSettings; onSave: (patch: Partial<WireSettings>) => Promise<string | null>;
}) {
  const [outfit, setOutfit] = useState<Outfit>("day");
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [sheets, setSheets] = useState<Record<Outfit, boolean>>({ day: false, night: false, lewd: false });
  const [sel, setSel] = useState<Cell | null>(null);
  const [n, setN] = useState(3);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [spent, setSpent] = useState<Spent | null>(null);
  const [batch, setBatch] = useState(0); // bumps after each generate so candidate <img>s reload
  const [gone, setGone] = useState<Set<string>>(new Set()); // candidate urls that 404'd
  const stop = useRef(false);

  const refresh = () => requestJson<{ sprites: Record<string, number>; sheets: Record<Outfit, boolean> }>("/api/mascot/sprites").then((r) => {
    if (!r.ok) return;
    setSprites(r.data.sprites); setSheets(r.data.sheets);
    window.dispatchEvent(new CustomEvent("mascot:sprites", { detail: r.data.sprites }));
  });
  useEffect(() => { if (open) refresh(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { stop.current = true; setConfirm(null); onClose(); }; // closing ends a run: no spending out of sight
  const choose = (c: Cell | null) => { setSel(c); setConfirm(null); setError(null); setNote(null); };
  const pickOutfit = (o: Outfit) => { setOutfit(o); choose(null); };

  /** Estimate first (one call per art kind in the list), then wait for the confirm tap. */
  async function ask(cells: Cell[]) {
    if (!cells.length || busy) return;
    setError(null); setNote(null); setBusy("Checking cost…");
    let total: number | null = 0, anlas: number | null = null;
    for (const kind of new Set(cells.map((c) => c.kind))) {
      const r = await studio<Estimate>({ action: "estimate", outfit, kind, expr: cells.find((c) => c.kind === kind)!.expr, n });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
      anlas = r.data.anlas;
      const count = cells.filter((c) => c.kind === kind).length;
      total = total === null || r.data.perImage === null ? null : total + r.data.perImage * r.data.n * count;
    }
    setBusy(null);
    setConfirm({ outfit, cells, n, total, anlas });
  }

  /** Runs only from the confirm button. Sequential; stops on the first error. */
  async function run(c: Confirm) {
    setConfirm(null); stop.current = false;
    let before: number | null = null, after: number | null = null, cost: number | null = 0;
    for (const [i, cell] of c.cells.entries()) {
      if (stop.current) break;
      setBusy(c.cells.length > 1 ? `Generating ${label(cell)} (${i + 1}/${c.cells.length})…` : "Generating…");
      const r = await studio<Spent>({ action: "generate", outfit: c.outfit, kind: cell.kind, expr: cell.expr, n: c.n, confirm: true });
      if (!r.ok) { setError(`${label(cell)}: ${r.error}`); break; }
      before ??= r.data.before; after = r.data.after;
      cost = cost === null || r.data.cost === null ? null : cost + r.data.cost;
    }
    setSpent({ before, after, cost });
    setBusy(null); setGone(new Set()); setBatch((b) => b + 1);
    if (c.cells.length === 1) setSel(c.cells[0]);
    else setNote("Tap each cell to pick its candidate.");
  }

  async function pick(cell: Cell, i: number) {
    setBusy("Saving (removing background)…"); setError(null); setNote(null);
    const r = await studio<{ ok: true; note?: string }>({ action: "pick", outfit, kind: cell.kind, expr: cell.expr, i });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setNote(r.data.note ?? "Saved.");
    refresh();
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("action", "sheet"); fd.append("outfit", outfit); fd.append("file", file);
    const r = await requestJson("/api/mascot/studio", { method: "POST", body: fd });
    if (r.ok) refresh(); else setError(r.error);
  }

  const src = (c: Cell) => { const k = `${outfit}/${name(c)}`; return k in sprites ? `/api/mascot/sprites/${k}?v=${sprites[k]}` : null; };
  const missing = missingCells(sprites, outfit);
  const candidates = sel ? [0, 1, 2, 3].map((i) => `/api/mascot/sprites/${outfit}/${name(sel)}?c=${i}&b=${batch}`) : [];

  const cellBtn = (c: Cell, cls: string) => {
    const s = src(c), on = sel?.kind === c.kind && sel.expr === c.expr;
    return (
      <button key={name(c)} type="button" onClick={() => choose(on ? null : c)} aria-pressed={on} aria-label={`${label(c)}${s ? "" : " (missing)"}`}
        className={`relative flex flex-col items-center justify-end overflow-hidden rounded-lg border ${s ? "border-border bg-bg" : "border-border border-dashed"} ${on ? "ring-accent ring-2" : ""} ${cls}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s && <img src={s} alt="" className="absolute inset-0 size-full object-contain" />}
        <span className="bg-surface/80 relative w-full py-0.5 text-center text-[11px] capitalize">{label(c)}</span>
      </button>
    );
  };

  return (
    <Sheet open={open} onClose={close} label="Sprite studio" closeLabel="Close sprite studio"
      className="h-[94dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-xl lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Sprite studio</h2>
        <button type="button" onClick={close} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <div role="tablist" aria-label="Outfit" className="border-border grid grid-cols-3 overflow-hidden rounded-md border">
          {OUTFITS.map((o) => (
            <button key={o} type="button" role="tab" aria-selected={outfit === o} disabled={!!busy} onClick={() => pickOutfit(o)}
              className={`h-11 text-sm font-medium capitalize ${outfit === o ? "bg-accent text-accent-fg" : "text-muted"}`}>{o}</button>
          ))}
        </div>

        <section className="grid grid-cols-[1fr_2fr] gap-2">
          {cellBtn({ kind: "full", expr: "smug" }, "min-h-48")}
          <div className="grid grid-cols-3 gap-2">{EXPRESSIONS.map((expr) => cellBtn({ kind: "bust", expr }, "aspect-square"))}</div>
        </section>

        <section className="space-y-2">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Candidates per sprite
            <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={!!busy} className="bg-bg border-border h-11 rounded-md border px-2 text-sm">
              {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {sel ? (
            <button type="button" disabled={!!busy || !!confirm} onClick={() => ask([sel])} className={`${btn} bg-accent text-accent-fg w-full border-transparent font-semibold`}>
              Generate {n} — <span className="capitalize">{label(sel)}</span>
            </button>
          ) : <p className="text-faint text-xs">Tap a cell to generate or pick its sprite.</p>}
          <button type="button" disabled={!!busy || !!confirm || !missing.length} onClick={() => ask(missing)} className={`${btn} w-full`}>
            Generate missing for this outfit ({missing.length})
          </button>

          {confirm && (
            <div role="alertdialog" aria-label="Confirm generation" className="border-accent/40 bg-accent-soft space-y-2 rounded-lg border p-3 text-sm">
              <p>{confirm.cells.length > 1 ? `${confirm.cells.length} sprites × ${confirm.n}` : `${confirm.n} candidate${confirm.n > 1 ? "s" : ""}`} ·{" "}
                <b>{confirm.total === 0 ? "Free on Opus" : confirm.total === null ? "Cost unknown — shown after" : `${confirm.total.toLocaleString()} Anlas`}</b></p>
              <p className="text-muted text-xs">Balance: {confirm.anlas === null ? "unknown" : `${confirm.anlas.toLocaleString()} Anlas`}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
                <button type="button" onClick={() => run(confirm)} className="bg-accent text-accent-fg flex-1 rounded-md px-3 py-2 font-semibold">Generate</button>
              </div>
            </div>
          )}
          {busy && <p aria-live="polite" className="text-muted text-sm">{busy}{busy.startsWith("Generating") && <button type="button" onClick={() => { stop.current = true; }} className="text-accent ml-2 min-h-11 px-2">Stop after this</button>}</p>}
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {note && <p aria-live="polite" className="text-sm">{note}</p>}
          {spent && !busy && <p className="text-muted text-xs">Anlas {spent.before ?? "?"} → {spent.after ?? "?"}{spent.cost !== null ? ` (spent ${spent.cost})` : ""}</p>}

          {sel && candidates.some((u) => !gone.has(u)) && (
            <div>
              <p className="mb-1 text-sm">Pick one for <span className="capitalize">{label(sel)}</span></p>
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((u, i) => !gone.has(u) && (
                  <button key={u} type="button" disabled={!!busy} onClick={() => pick(sel, i)} aria-label={`Use candidate ${i + 1}`}
                    className="border-border bg-bg overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="w-full object-contain" onError={() => setGone((g) => new Set(g).add(u))} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <TagEditors outfit={outfit} settings={settings} onSave={onSave} />

        <section>
          <h3 className={h3}>Character sheet</h3>
          <label className={`${btn} block cursor-pointer text-center`}>
            {sheets[outfit] ? "Replace" : "Upload"} the {outfit} sheet
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          </label>
          <p className="text-faint mt-1 text-xs">Kept for later: V5 sprites are tag-only until Precise Reference works again.</p>
        </section>
      </div>
    </Sheet>
  );
}

type Field = { key: string; label: string; value: string; def: string; patch: (v: string) => Partial<WireSettings> };

/** Collapsible tag editors: character, constant, this outfit's layer, per expression. Each saves its own patch. */
function TagEditors({ outfit, settings: s, onSave }: { outfit: Outfit; settings: WireSettings; onSave: (patch: Partial<WireSettings>) => Promise<string | null> }) {
  const D = DEFAULT_MASCOT_SETTINGS;
  const fields: Field[] = [
    { key: "char", label: "Character", value: s.charTags, def: D.charTags, patch: (v) => ({ charTags: v }) },
    { key: "constant", label: "Constant pieces (all outfits)", value: s.constantTags, def: D.constantTags, patch: (v) => ({ constantTags: v }) },
    { key: `layer-${outfit}`, label: `${outfit} outfit`, value: s.layerTags[outfit], def: D.layerTags[outfit], patch: (v) => ({ layerTags: { ...s.layerTags, [outfit]: v } }) },
    ...EXPRESSIONS.map((e) => ({ key: `expr-${e}`, label: `Expression: ${e}`, value: s.exprTags[e], def: D.exprTags[e], patch: (v: string) => ({ exprTags: { ...s.exprTags, [e]: v } }) })),
  ];
  return (
    <section>
      <h3 className={h3}>Tags</h3>
      <div className="space-y-1">{fields.map((f) => <TagField key={f.key} field={f} onSave={onSave} />)}</div>
    </section>
  );
}

function TagField({ field: f, onSave }: { field: Field; onSave: (patch: Partial<WireSettings>) => Promise<string | null> }) {
  const [draft, setDraft] = useState(f.value);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { if (!failed) setDraft(f.value); }, [f.value]); // eslint-disable-line react-hooks/exhaustive-deps -- a failed save keeps the draft
  const dirty = draft !== f.value;
  return (
    <details className="border-border rounded-md border px-2">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm capitalize">{f.label}{dirty && <span className="text-accent text-xs normal-case">unsaved</span>}</summary>
      <div className="space-y-2 pb-2">
        <AutoTextarea value={draft} onChange={setDraft} className="font-mono text-sm" />
        {draft.length > 1500 && <p className="text-danger text-xs">Too long ({draft.length}/1500) — won&apos;t save.</p>}
        {failed && <p role="alert" className="text-danger text-xs">Not saved — {failed}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={draft === f.def} onClick={() => setDraft(f.def)} className={`${btn} flex-1`}>Reset to default</button>
          <button type="button" disabled={!dirty || draft.length > 1500} onClick={async () => setFailed(await onSave(f.patch(draft)))} className={`${btn} bg-accent text-accent-fg flex-1 border-transparent font-semibold`}>Save</button>
        </div>
      </div>
    </details>
  );
}
