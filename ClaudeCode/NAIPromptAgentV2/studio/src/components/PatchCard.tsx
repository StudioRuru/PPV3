"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { opTags, type Op } from "@/lib/patch";
import { DOT } from "./BlockDrawer";

const LABEL = { add: "+", remove: "−", replace: "=", weight: "×" } as const;
const where = (t: Op["target"]) => (t === "base" ? "Base" : t === "uc" ? "UC" : `Char ${Number(t.slice(5)) + 1}`);

export function PatchCard({ ops, onApply }: { ops: Op[]; onApply: () => void }) {
  const [unknown, setUnknown] = useState<string[]>([]);
  const [done, setDone] = useState<"applied" | "discarded" | null>(null);
  // Keyed on the tag list, not the ops array: the sheet re-parses replies (new arrays) on every streamed chunk.
  const tags = opTags(ops).join("\n");
  useEffect(() => {
    requestJson<{ unknown: string[] }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: tags.split("\n").filter(Boolean) }) })
      .then((r) => r.ok && setUnknown(r.data.unknown));
  }, [tags]);
  return (
    <div className="border-accent/40 bg-surface-2 mt-2 rounded-lg border p-2.5 text-sm">
      <p className="text-muted mb-1.5 text-[11px] font-medium tracking-wide uppercase">{ops.length} suggested change{ops.length === 1 ? "" : "s"}</p>
      <ul className="space-y-1">
        {ops.map((o, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted flex w-[4.75rem] shrink-0 items-start gap-1 font-mono whitespace-nowrap text-xs leading-5">
              {LABEL[o.action]} {o.target.startsWith("char:") && <i aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: DOT[Number(o.target.slice(5)) % DOT.length] }} />}{where(o.target)}
            </span>
            <span className="break-words">{o.weight ? <b className="text-accent font-mono text-xs">{o.weight} </b> : null}{o.line}</span>
          </li>
        ))}
      </ul>
      {unknown.length > 0 && <p className="text-warn mt-2 text-xs">Not in the tag list: {unknown.join(", ")}</p>}
      {done ? <p className="text-muted mt-2 text-xs">{done === "applied" ? "Applied" : "Discarded"}</p> : (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => { onApply(); setDone("applied"); }} className="bg-accent text-accent-fg h-11 flex-1 rounded-md font-semibold">Apply</button>
          <button type="button" onClick={() => setDone("discarded")} className="border-border h-11 flex-1 rounded-md border">Discard</button>
        </div>
      )}
    </div>
  );
}
