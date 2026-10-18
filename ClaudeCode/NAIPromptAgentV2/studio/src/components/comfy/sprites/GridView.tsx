"use client";
import { useState } from "react";
import type { Surface } from "@/lib/sprites/core";
import { type CellView, gridRows } from "./grid";
import { Chip, Clip, TakesSheet, shown } from "./TakesSheet";
import type { Ensure, Inv } from "./SpritesScreen";

/** Chat: key x key matrix. Stage: every edge both ways, plus the idles. Cells appear as the server creates them. */
export function GridView({ surface, outfit, inv, onAct, ensure }: { surface: Surface; outfit: string; inv: Inv; onAct: (cellId: number, body: object) => Promise<void>; ensure: Ensure }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const keys = inv.keys.filter((k) => k.surface === surface);
  const label = (k: string) => keys.find((x) => x.key === k)?.label ?? k;
  const mine = inv.cells.filter((c) => c.surface === surface && c.outfit === outfit);
  const find = (a: string, b: string) => mine.find((c) => c.from === a && c.to === b) ?? null;
  const open = openId == null ? null : inv.cells.find((c) => c.id === openId) ?? null;

  const tile = (c: CellView | null, from: string, to: string, reverse: boolean, size: string) => {
    const isRev = reverse && !(c && !c.reverse); // a reverse cell shows its mirror's clip until it has its own
    const src = isRev ? find(to, from) : c;
    const t = src && shown(src);
    return (
      <button key={`${from}>${to}`} type="button" onClick={async () => { const id = c?.id ?? await ensure(surface, outfit, from, to); if (id != null) setOpenId(id); }} aria-label={`${label(from)} to ${label(to)}${c ? ` ${c.status}` : ""}`}
        className={`border-border bg-surface relative overflow-hidden rounded border ${size} ${c ? "" : "opacity-60"} ${from === to ? "border-accent" : ""}`}>
        {t ? <Clip t={t} className="size-full object-cover" /> : <span aria-hidden className="text-faint grid size-full place-items-center text-xs">·</span>}
        {isRev && <span className="absolute top-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">↺ reverse</span>}
        {src && <span className="absolute right-0.5 bottom-0.5"><Chip s={src.status} /></span>}
      </button>
    );
  };

  let body;
  if (surface === "chat") {
    const rows = gridRows(inv.allowed(surface, outfit), inv.cells, outfit);
    body = (
      <div className="overflow-x-auto pb-2">
        <table className="border-separate border-spacing-1 text-xs">
          <thead><tr><th />{rows.map((r) => <th key={r.from} className="text-muted max-w-24 px-1 text-center font-normal">{label(r.from)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.from}>
                <th scope="row" className="text-muted pr-2 text-right font-normal whitespace-nowrap">{label(r.from)}</th>
                {r.cols.map((c) => <td key={c.to}>{tile(c.cell, r.from, c.to, c.reverse, "h-24 w-16")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    const ok = new Set(inv.allowed(surface, outfit).map((k) => k.key));
    const pairs = [...inv.edges.filter(([a, b]) => ok.has(a) && ok.has(b)).flatMap(([a, b]) => [[a, b], [b, a]]), ...[...ok].map((k) => [k, k])];
    body = (
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {pairs.map(([a, b]) => (
          <li key={`${a}>${b}`} className="space-y-1">
            {tile(find(a, b), a, b, false, "h-40 w-full")}
            <p className="text-muted truncate text-xs">{a === b ? `${label(a)} (idle)` : `${label(a)} → ${label(b)}`}</p>
          </li>
        ))}
        {pairs.length === 0 && <li className="text-muted text-sm">No poses yet.</li>}
      </ul>
    );
  }
  const mirror = open && open.reverse ? find(open.to, open.from) : null;
  return (
    <>
      {body}
      {open && <TakesSheet cell={open} mirror={open.reverse && !open.takes.some((t) => t.file) ? mirror ?? open : null} title={open.from === open.to ? `${label(open.from)} idle` : `${label(open.from)} → ${label(open.to)}`} onClose={() => setOpenId(null)} onAct={onAct} />}
    </>
  );
}
