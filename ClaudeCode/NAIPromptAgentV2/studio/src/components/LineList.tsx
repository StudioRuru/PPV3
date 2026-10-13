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
            className="text-muted w-6 pt-2 text-right text-xs">{i + 1}</button>
          <TagInput value={l.text} onChange={(text) => set(i, { text })} placeholder="tags or natural language" />
          <input type="number" step="0.05" inputMode="decimal" aria-label="Weight" placeholder="1"
            value={l.weight ?? ""} onChange={(e) => set(i, { weight: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="bg-bg border-border w-16 rounded-md border px-2 py-2 text-base" />
          <button type="button" aria-label="Delete line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [newLine()])}
            className="text-muted px-2 py-2">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="text-accent text-sm">+ line</button>
    </div>
  );
}
