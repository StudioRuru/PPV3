"use client";
import { newLine, type CharBox, type Positions } from "@/lib/prompt";
import { LineList } from "./LineList";
import { PositionCanvas } from "./PositionCanvas";

export function CharacterBoxes({ chars, onChange, positions, onPositions, width, height }: {
  chars: CharBox[]; onChange: (c: CharBox[]) => void;
  positions: Positions; onPositions: (p: Positions) => void; width: number; height: number;
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
          {positions === "custom" && <PositionCanvas chars={chars} width={width} height={height} onChange={onChange} />}
        </section>
      )}
      {chars.map((c, i) => (
        <section key={c.id} className="bg-surface border-border rounded-lg border p-3">
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
