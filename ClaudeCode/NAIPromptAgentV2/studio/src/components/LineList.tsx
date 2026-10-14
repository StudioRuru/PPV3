"use client";
import { useState } from "react";
import { newLine, type Line } from "@/lib/prompt";
import { fromOffset, offsetLabel, toOffset } from "@/lib/weight";
import { Broom, Trash } from "./icons";
import { TagInput } from "./TagInput";

const changed = (w: number | undefined) => w !== undefined && w !== 1;
const pct = (o: number) => `${((o + 2) / 4) * 100}%`; // offset −2…+2 → track position

/**
 * Emphasis slider centred on normal: 0 = unweighted (NovelAI weight 1). Right adds emphasis; left reduces,
 * and past −1 (weight below 0) steers away from the tag. The shaded band is the sweet spot (weight 0.8–1.3).
 */
export function WeightSlider({ value, onChange }: { value: number | undefined; onChange: (w: number | undefined) => void }) {
  const o = toOffset(value);
  const track = `linear-gradient(90deg,
    color-mix(in srgb, var(--color-warn) 28%, transparent) 0 ${pct(-1)},
    var(--color-surface-2) ${pct(-1)} ${pct(-0.2)},
    color-mix(in srgb, var(--color-accent) 30%, var(--color-surface-2)) ${pct(-0.2)} ${pct(0.3)},
    var(--color-surface-2) ${pct(0.3)} 100%)`;
  return (
    <div className="animate-rise space-y-1 pl-7">
      <div className="flex items-center gap-3">
        <div className="relative h-9 min-w-0 flex-1">
          {/* Drawn track inset by half the 22px thumb, so ticks and bands line up with where the thumb can go. */}
          <div aria-hidden="true" className="absolute inset-x-[11px] top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ background: track }} />
          <div aria-hidden="true" className="bg-muted absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: "50%" }} />
          <input type="range" min={-2} max={2} step={0.05} value={o} aria-label="Weight offset (0 = normal)" aria-valuetext={offsetLabel(value)}
            onChange={(e) => onChange(fromOffset(Number(e.target.value)))} className="weight-range absolute inset-0 w-full" />
        </div>
        <span className={`w-14 text-right font-mono text-sm tabular-nums ${o < -1 ? "text-warn" : changed(value) ? "text-accent" : "text-muted"}`}>{offsetLabel(value)}</span>
      </div>
      <div aria-hidden="true" className="text-faint relative mr-[calc(4.25rem+11px)] ml-[11px] h-3 font-mono text-[10px]">
        {[-2, -1, 0, 1, 2].map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>{t > 0 ? `+${t}` : t === 0 ? "0" : `−${-t}`}</span>)}
      </div>
      <div className="flex gap-1.5 pt-1">
        {[[0, "Normal"], [0.2, "+0.2"], [0.5, "+0.5"], [-1, "Remove (0×)"]].map(([v, label]) => (
          <button key={label as string} type="button" onClick={() => onChange(fromOffset(v as number))}
            className={`h-8 rounded-full border px-2.5 font-mono text-[11px] ${o === v ? "border-accent text-accent" : "border-border text-muted"}`}>{label as string}</button>
        ))}
      </div>
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
            {/* Weight pill above broom (clear text) + trash (delete line): one narrow column, so the text keeps the width. */}
            <div className="flex w-14 shrink-0 flex-col items-stretch gap-1">
              <button type="button" aria-expanded={open === l.id} aria-label={`Weight ${offsetLabel(l.weight)} — tap to adjust, double-tap for normal`}
                onClick={() => setOpen(open === l.id ? null : l.id)} onDoubleClick={() => set(i, { weight: undefined })}
                className={`h-10 w-full rounded-md border font-mono text-sm tabular-nums ${
                  toOffset(l.weight) < -1 ? "border-warn/50 text-warn bg-bg" : changed(l.weight) ? "bg-accent-soft text-accent-ink border-transparent" : "bg-bg border-border text-muted"}`}>
                {offsetLabel(l.weight)}
              </button>
              <div className="text-faint grid grid-cols-2">
                <button type="button" aria-label="Clear line" disabled={!l.text} onClick={() => set(i, { text: "" })}
                  className="hover:text-fg grid h-8 place-items-center disabled:opacity-30"><Broom /></button>
                <button type="button" aria-label="Delete line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [newLine()])}
                  className="hover:text-danger grid h-8 place-items-center"><Trash /></button>
              </div>
            </div>
          </div>
          {open === l.id && <WeightSlider value={l.weight} onChange={(weight) => set(i, { weight })} />}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="text-accent text-sm">{addLabel}</button>
    </div>
  );
}
