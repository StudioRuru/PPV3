"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { opTags, type Op } from "@/lib/patch";
import { DOT } from "./BlockDrawer";

const LABEL = { add: "+", remove: "−", replace: "=", weight: "×" } as const;
const where = (t: Op["target"]) => (t === "base" ? "Base" : t === "uc" ? "UC" : t === "artist" ? "Artist" : `Char ${Number(t.slice(5)) + 1}`);

/**
 * The co-pilot's suggested changes. Each can be switched off before Apply; tags that aren't in the Danbooru list are
 * marked "NL" — V5 reads natural language, so they're allowed, just not tag-list matches.
 */
export function PatchCard({ ops, onApply }: { ops: Op[]; onApply: (picked: Op[]) => void }) {
  const [nl, setNl] = useState<string[]>([]);
  const [off, setOff] = useState<number[]>([]);
  const [done, setDone] = useState<"applied" | "discarded" | null>(null);
  // Keyed on the tag list, not the ops array: the screen re-parses replies (new arrays) on every streamed chunk.
  const tags = opTags(ops).join("\n");
  useEffect(() => {
    requestJson<{ unknown: string[] }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: tags.split("\n").filter(Boolean) }) })
      .then((r) => r.ok && setNl(r.data.unknown));
  }, [tags]);
  const picked = ops.filter((_, i) => !off.includes(i));
  const hasNl = (line: string) => nl.filter((t) => line.toLowerCase().includes(t.toLowerCase()));

  return (
    <div className={`animate-rise bg-surface-2 mt-2 rounded-lg border p-2.5 text-sm transition-[border-color,opacity] duration-300 ${done === "applied" ? "border-ok/60" : done === "discarded" ? "border-border opacity-60" : "border-accent/40"}`}>
      <p className="text-muted mb-1.5 text-[11px] font-medium tracking-wide uppercase">{ops.length} suggested change{ops.length === 1 ? "" : "s"}{!done && off.length ? ` · ${picked.length} selected` : ""}</p>
      <div className="fold" data-collapsed={done === "discarded" || undefined}><div>
      <ul className="space-y-1">
        {ops.map((o, i) => {
          const on = !off.includes(i);
          return (
            <li key={i}>
              <label className={`flex cursor-pointer gap-2 ${on ? "" : "opacity-45"}`}>
                {!done && <input type="checkbox" checked={on} onChange={() => setOff(on ? [...off, i] : off.filter((x) => x !== i))} aria-label={`Include change ${i + 1}`} className="accent-accent mt-1 size-4 shrink-0" />}
                <span className="text-muted flex w-[4.75rem] shrink-0 items-start gap-1 font-mono whitespace-nowrap text-xs leading-5">
                  {LABEL[o.action]} {o.target.startsWith("char:") && <i aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: DOT[Number(o.target.slice(5)) % DOT.length] }} />}{where(o.target)}
                </span>
                <span className="min-w-0 break-words">{o.weight ? <b className="text-accent font-mono text-xs">{o.weight} </b> : null}{o.line}
                  {hasNl(o.line).map((t) => (
                    <span key={t} title="Not a Danbooru tag — V5 reads it as natural language" className="border-cyan/60 text-cyan ml-1 inline-flex items-center gap-1 rounded border border-dashed px-1 font-mono text-[10px]">NL {t}</span>
                  ))}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {nl.length > 0 && <p className="text-faint mt-2 text-xs"><span className="text-cyan">NL</span> = not a Danbooru tag; V5 still reads it as natural language.</p>}
      </div></div>
      {done ? (
        <p role="status" className={`animate-rise mt-2 flex items-center gap-1.5 text-xs ${done === "applied" ? "text-ok" : "text-muted"}`}>
          {done === "applied" && <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="check-draw" /></svg>}
          {done === "applied" ? `Applied ${picked.length}` : "Discarded"}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={!picked.length} onClick={() => { onApply(picked); setDone("applied"); }} className="bg-accent text-accent-fg h-11 flex-1 rounded-md font-semibold disabled:opacity-40">Apply{off.length ? ` ${picked.length}` : ""}</button>
          <button type="button" onClick={() => setDone("discarded")} className="border-border h-11 flex-1 rounded-md border">Discard</button>
        </div>
      )}
    </div>
  );
}
