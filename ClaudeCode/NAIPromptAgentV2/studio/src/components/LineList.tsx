"use client";
import { useState } from "react";
import { newLine, type Line } from "@/lib/prompt";
import { TagInput } from "./TagInput";

const fmt = (w: number | undefined) => (w ?? 1).toFixed(2);
const changed = (w: number | undefined) => w !== undefined && w !== 1;

/** Emphasis slider, −2…+2 (NovelAI numeric weights; negative steers away from the tag). 1 = unweighted. */
export function WeightSlider({ value, onChange }: { value: number | undefined; onChange: (w: number | undefined) => void }) {
  const v = value ?? 1;
  return (
    <div className="animate-rise flex items-center gap-3 pl-7">
      <input type="range" min={-2} max={2} step={0.05} value={v} aria-label="Weight"
        onChange={(e) => { const n = Math.round(Number(e.target.value) * 100) / 100; onChange(n === 1 ? undefined : n); }}
        className="accent-accent h-9 min-w-0 flex-1" />
      <span className={`w-12 text-right font-mono text-sm ${v < 0 ? "text-warn" : changed(value) ? "text-accent" : "text-muted"}`}>{fmt(value)}</span>
      <button type="button" onClick={() => onChange(undefined)} disabled={!changed(value)} className="text-accent h-9 px-1 text-sm disabled:opacity-30">Reset</button>
    </div>
  );
}

export function LineList({ lines, onChange, placeholder = "tags or natural language", addLabel = "+ line" }: {
  lines: Line[]; onChange: (l: Line[]) => void; placeholder?: string; addLabel?: string;
}) {
  const [open, setOpen] = useState<string | null>(null); // line whose weight slider is showing
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={l.id} className={`space-y-1 ${l.enabled ? "" : "opacity-40"}`}>
          <div className="flex items-start gap-2">
            <button type="button" aria-label={l.enabled ? "Disable line" : "Enable line"} onClick={() => set(i, { enabled: !l.enabled })}
              className="text-faint w-5 shrink-0 pt-2.5 text-right font-mono text-xs">{i + 1}</button>
            <TagInput value={l.text} onChange={(text) => set(i, { text })} placeholder={placeholder} />
            {/* Weight pill and delete share one narrow column so the text gets the width (and grows downward). */}
            <div className="flex w-14 shrink-0 flex-col items-stretch gap-1">
              <button type="button" aria-expanded={open === l.id} aria-label={`Weight ${fmt(l.weight)} — tap to adjust, double-tap to reset`}
                onClick={() => setOpen(open === l.id ? null : l.id)} onDoubleClick={() => set(i, { weight: undefined })}
                className={`h-10 w-full rounded-md border font-mono text-sm tabular-nums ${
                  (l.weight ?? 1) < 0 ? "border-warn/50 text-warn bg-bg" : changed(l.weight) ? "bg-accent-soft text-accent-ink border-transparent" : "bg-bg border-border text-muted"}`}>
                {fmt(l.weight)}
              </button>
              <button type="button" aria-label="Delete line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [newLine()])}
                className="text-faint hover:text-danger h-8 text-sm">✕</button>
            </div>
          </div>
          {open === l.id && <WeightSlider value={l.weight} onChange={(weight) => set(i, { weight })} />}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="text-accent text-sm">{addLabel}</button>
    </div>
  );
}
