"use client";
import type { PhotoRecipe } from "@/lib/comfy/recipe";

const SIZES: [string, number, number][] = [["Portrait", 832, 1216], ["Landscape", 1216, 832], ["Square", 1024, 1024], ["Tall", 768, 1344]];
const snap = (v: number) => Math.min(2048, Math.max(512, Math.round(v / 64) * 64));
const field = "bg-bg border-border h-11 w-full rounded-md border px-2 text-base";

/** Tune tool: seed, steps, CFG, sampler/scheduler, size, negative prompt and hi-res. */
export function TuneSheet({ r, samplers, schedulers, onChange }: {
  r: PhotoRecipe; samplers: string[]; schedulers: string[]; onChange: (patch: Partial<PhotoRecipe>) => void;
}) {
  const opts = (list: string[], cur: string) => (list.includes(cur) ? list : [cur, ...list]);
  const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2">
        <label className="flex-1">Seed (−1 = random)
          <input type="number" inputMode="numeric" className={field} value={r.seed} onChange={(e) => { const n = num(e.target.value); if (n !== null) onChange({ seed: Math.trunc(n) }); }} />
        </label>
        <button type="button" aria-label="Roll a random seed" onClick={() => onChange({ seed: Math.floor(Math.random() * 2 ** 32) })}
          className="border-border mt-5 size-11 shrink-0 rounded-md border text-lg">🎲</button>
      </div>
      <div className="flex gap-2">
        <label className="flex-1">Steps
          <input type="number" inputMode="numeric" min={1} max={150} className={field} value={r.steps} onChange={(e) => { const n = num(e.target.value); if (n !== null) onChange({ steps: Math.trunc(n) }); }} />
        </label>
        <label className="flex-1">CFG
          <input type="number" inputMode="decimal" step={0.5} min={0} max={30} className={field} value={r.cfg} onChange={(e) => { const n = num(e.target.value); if (n !== null) onChange({ cfg: n }); }} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">Sampler
          <select className={field} value={r.sampler} onChange={(e) => onChange({ sampler: e.target.value })}>
            {opts(samplers, r.sampler).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1">Scheduler
          <select className={field} value={r.scheduler} onChange={(e) => onChange({ scheduler: e.target.value })}>
            {opts(schedulers, r.scheduler).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {SIZES.map(([label, w, h]) => (
          <button key={label} type="button" aria-pressed={r.width === w && r.height === h} onClick={() => onChange({ width: w, height: h })}
            className={`min-h-11 rounded-full border px-3 text-xs ${r.width === w && r.height === h ? "bg-accent text-accent-fg border-accent" : "border-border text-muted"}`}>{label} {w}×{h}</button>
        ))}
      </div>
      <div className="flex gap-2">
        {(["width", "height"] as const).map((k) => (
          <label key={k} className="flex-1 capitalize">{k}
            <input type="number" inputMode="numeric" step={64} className={field} value={r[k]} onChange={(e) => { const n = num(e.target.value); if (n !== null && n >= 64) onChange({ [k]: n }); }}
              onBlur={() => onChange({ [k]: snap(r[k]) })} />
          </label>
        ))}
      </div>
      <label className="block">Negative prompt
        <textarea rows={3} className="bg-bg border-border w-full rounded-md border px-2 py-1 text-base" value={r.negative} onChange={(e) => onChange({ negative: e.target.value })} />
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="accent-accent size-5" checked={!!r.hires} onChange={(e) => onChange({ hires: e.target.checked ? { scale: 1.5, denoise: 0.4 } : null })} />
        Hi-res pass
      </label>
      {r.hires && (
        <div className="flex gap-2">
          <label className="flex-1">Scale {r.hires.scale}
            <input type="range" min={1} max={2} step={0.1} className="accent-accent h-8 w-full" value={r.hires.scale}
              onChange={(e) => onChange({ hires: { ...r.hires!, scale: Number(e.target.value) } })} />
          </label>
          <label className="flex-1">Denoise {r.hires.denoise}
            <input type="range" min={0} max={1} step={0.05} className="accent-accent h-8 w-full" value={r.hires.denoise}
              onChange={(e) => onChange({ hires: { ...r.hires!, denoise: Number(e.target.value) } })} />
          </label>
        </div>
      )}
    </div>
  );
}
