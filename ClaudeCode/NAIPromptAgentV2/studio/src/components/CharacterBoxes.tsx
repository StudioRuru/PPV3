"use client";
import { newLine, type CharBox } from "@/lib/prompt";
import { LineList } from "./LineList";

export function CharacterBoxes({ chars, onChange }: { chars: CharBox[]; onChange: (c: CharBox[]) => void }) {
  const set = (i: number, patch: Partial<CharBox>) => onChange(chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
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
          {/* ponytail: numeric x/y (0–1); a drag-on-canvas picker comes with the design pass. */}
          <div className="text-muted mt-2 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!c.center} onChange={(e) => set(i, { center: e.target.checked ? { x: 0.5, y: 0.5 } : undefined })} />
              Custom position
            </label>
            {c.center && (["x", "y"] as const).map((k) => (
              <input key={k} aria-label={`Position ${k}`} type="number" min="0" max="1" step="0.1" value={c.center![k]}
                onChange={(e) => set(i, { center: { ...c.center!, [k]: Math.min(1, Math.max(0, Number(e.target.value))) } })}
                className="bg-bg border-border w-16 rounded-md border px-2 py-1 text-base" />
            ))}
          </div>
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
