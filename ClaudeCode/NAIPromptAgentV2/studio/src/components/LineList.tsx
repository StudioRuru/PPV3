"use client";
import { newLine, type Line } from "@/lib/prompt";
import { TagInput } from "./TagInput";

export function LineList({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={l.id} className={`flex items-start gap-2 ${l.enabled ? "" : "opacity-40"}`}>
          <button type="button" aria-label={l.enabled ? "Disable line" : "Enable line"} onClick={() => set(i, { enabled: !l.enabled })}
            className="text-faint w-5 shrink-0 pt-2.5 text-right font-mono text-xs">{i + 1}</button>
          <TagInput value={l.text} onChange={(text) => set(i, { text })} placeholder="tags or natural language" />
          {/* Weight and delete share one narrow column so the text gets the width (and grows downward). */}
          <div className="flex w-14 shrink-0 flex-col items-stretch gap-1">
            <input type="number" step="0.05" inputMode="decimal" aria-label="Weight" placeholder="1"
              value={l.weight ?? ""} onChange={(e) => set(i, { weight: e.target.value === "" ? undefined : Number(e.target.value) })}
              className={`h-10 w-full rounded-md border px-1.5 text-center font-mono text-base ${l.weight !== undefined && l.weight !== 1 ? "bg-accent-soft text-accent-ink border-transparent" : "bg-bg border-border"}`} />
            <button type="button" aria-label="Delete line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [newLine()])}
              className="text-faint hover:text-danger h-8 text-sm">✕</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="text-accent text-sm">+ line</button>
    </div>
  );
}
