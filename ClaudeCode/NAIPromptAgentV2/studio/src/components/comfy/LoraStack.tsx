"use client";
import type { Lora } from "@/lib/comfy/recipe";

/** LoRA tool: one −2…2 slider per picked LoRA, then the pod's remaining LoRAs to add. */
export function LoraStack({ loras, available, onChange }: { loras: Lora[]; available: string[] | null; onChange: (l: Lora[]) => void }) {
  const left = (available ?? []).filter((n) => !loras.some((l) => l.name === n));
  return (
    <div className="space-y-3">
      {loras.map((l, i) => (
        <div key={l.name} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm">{l.name.replace(/\.safetensors$/, "")}</span>
            <span className="text-muted w-12 text-right font-mono text-xs">{l.strength.toFixed(2)}</span>
            <button type="button" aria-label={`Remove ${l.name}`} onClick={() => onChange(loras.filter((_, j) => j !== i))}
              className="border-border text-muted size-11 rounded-full border text-lg">×</button>
          </div>
          <input type="range" min={-2} max={2} step={0.05} value={l.strength} aria-label={`${l.name} strength`} className="accent-accent h-8 w-full"
            onChange={(e) => onChange(loras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)))} />
        </div>
      ))}
      {available === null ? <p className="text-muted text-sm">Waiting for GPU…</p>
        : loras.length >= 10 ? <p className="text-muted text-sm">10 LoRAs is the limit.</p>
        : !left.length ? <p className="text-muted text-sm">{available.length ? "All LoRAs are in the stack." : "No LoRAs on the GPU."}</p>
        : (
          <div className="flex flex-wrap gap-2">
            {left.map((n) => (
              <button key={n} type="button" onClick={() => onChange([...loras, { name: n, strength: 0.8 }])}
                className="border-border min-h-11 rounded-full border px-3 text-xs">+ {n.replace(/\.safetensors$/, "")}</button>
            ))}
          </div>
        )}
    </div>
  );
}
