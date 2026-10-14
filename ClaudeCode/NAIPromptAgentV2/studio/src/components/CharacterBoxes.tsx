"use client";
import { newLine, positionWords, regionOf, type CharBox, type Positions } from "@/lib/prompt";
import { DOT } from "./BlockDrawer";
import { LineList } from "./LineList";
import { PositionCanvas } from "./PositionCanvas";

export function CharacterBoxes({ chars, onChange, positions, onPositions, width, height, words, onWords }: {
  chars: CharBox[]; onChange: (c: CharBox[]) => void;
  positions: Positions; onPositions: (p: Positions) => void; width: number; height: number;
  words: boolean; onWords: (on: boolean) => void;
}) {
  const set = (i: number, patch: Partial<CharBox>) => onChange(chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {chars.length > 0 && (
        <section className="bg-surface border-border space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Position</span>
            <div role="radiogroup" aria-label="Character positions" className="border-border flex overflow-hidden rounded-md border">
              {([["ai", "AI decides"], ["custom", "Custom"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={positions === v} onClick={() => onPositions(v)}
                  className={`px-3 py-2 ${positions === v ? "bg-accent text-accent-fg" : ""}`}>{label}</button>
              ))}
            </div>
          </div>
          {positions === "custom" && <>
            <PositionCanvas chars={chars} width={width} height={height} onChange={onChange} words={words} />
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span>Position words<span className="text-muted block text-xs">Adds where each box is to its prompt — stronger placement</span></span>
              <input type="checkbox" role="switch" checked={words} onChange={(e) => onWords(e.target.checked)} className="accent-accent size-5" />
            </label>
            {words && (
              <ul className="space-y-0.5 font-mono text-[11px]">
                {chars.map((c, i) => c.enabled && (
                  <li key={c.id} className="text-muted flex gap-2"><span style={{ color: DOT[i % DOT.length] }}>{i + 1}</span>{positionWords(regionOf(c, i, chars.length))}</li>
                ))}
              </ul>
            )}
          </>}
        </section>
      )}
      {chars.map((c, i) => (
        <section key={c.id} data-drop={`char:${i}`} style={{ "--dot": DOT[i % DOT.length] } as React.CSSProperties} className="bg-surface border-border rounded-lg border p-3">
          <header className="mb-2 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={c.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
              Character {i + 1}
            </label>
            <button type="button" className="text-muted" onClick={() => onChange(chars.filter((_, j) => j !== i))}>Remove</button>
          </header>
          <LineList lines={c.lines} onChange={(lines) => set(i, { lines })} />
          <input value={c.uc} onChange={(e) => set(i, { uc: e.target.value })} placeholder="character undesired content"
            className="bg-bg border-border mt-2 w-full rounded-md border px-2 py-2 text-base" />
        </section>
      ))}
      {chars.length < 22 && (
        <button type="button" className="text-accent text-sm"
          onClick={() => onChange([...chars, { id: newLine().id, lines: [newLine("girl")], uc: "", enabled: true }])}>
          + character
        </button>
      )}
    </div>
  );
}
