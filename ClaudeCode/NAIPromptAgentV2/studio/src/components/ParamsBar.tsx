"use client";
import { useEffect, useState } from "react";
import { isFree } from "@/lib/grid";
import { fixSchedule, MODELS, SAMPLERS, schedulesFor, type NaiParams, type Quality, type UcPreset } from "@/lib/nai-body";
import type { Rating } from "@/lib/prompt";
import { deviceSize, matchPreset, PRESETS, ratioLabel, rotate, type Orientation } from "@/lib/sizes";
import { Chevron, ClearCircle, Rotate } from "./icons";
import { Sheet } from "./Sheet";

const field = "bg-bg border-border rounded-md border px-2 py-2 font-mono text-base";
const seg = (on: boolean) => `h-10 px-3 text-xs font-medium ${on ? "bg-accent text-accent-fg" : "text-muted"}`;
const ORIENTATIONS: [Orientation, string][] = [["portrait", "Portrait"], ["landscape", "Landscape"], ["square", "Square"], ["wallpaper", "Wallpaper"]];

/** SFW | NSFW in one tap. NSFW puts "nsfw" first in the prompt; SFW puts it first in Undesired Content (NovelAI's behaviour). */
function RatingSwitch({ rating, onRating }: { rating: Rating; onRating: (r: Rating) => void }) {
  const nsfw = rating === "nsfw";
  return (
    <button type="button" role="switch" aria-checked={nsfw} aria-label="NSFW" onClick={() => onRating(nsfw ? "safe" : "nsfw")}
      className="border-border relative flex h-10 shrink-0 items-center overflow-hidden rounded-full border font-mono text-xs font-medium">
      <span className={`relative z-10 px-3 ${!nsfw ? "text-accent-fg" : "text-muted"}`}>SFW</span>
      <span className={`relative z-10 px-3 ${nsfw ? "text-accent-fg" : "text-muted"}`}>NSFW</span>
      <span aria-hidden="true" className={`bg-accent absolute inset-y-0 w-1/2 rounded-full transition-[translate] duration-200 ${nsfw ? "translate-x-full" : ""}`} />
    </button>
  );
}

/** A slider paired with a number field; typed values clamp when the field loses focus. */
function SliderField({ label, min, max, step, value, onChange, disabled, hint }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; disabled?: boolean; hint?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const commit = () => { const n = Number(text); onChange(Number.isFinite(n) && text.trim() !== "" ? Number(clamp(n).toFixed(2)) : value); };
  return (
    <label className={`block ${disabled ? "opacity-50" : ""}`}>
      <span className="text-muted flex items-baseline justify-between text-xs">{label}{hint && <span className="text-faint font-mono">{hint}</span>}</span>
      <span className="mt-1 flex items-center gap-3">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))} className="accent-accent h-9 min-w-0 flex-1" />
        <input type="number" inputMode="decimal" min={min} max={max} step={step} value={text} disabled={disabled} aria-label={`${label} value`}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()}
          className={`${field} w-20 text-center`} />
      </span>
      <span className="text-faint flex justify-between font-mono text-[10px]"><span>{min}</span><span>{max}</span></span>
    </label>
  );
}

export function ParamsBar({ params, onParams, rating, onRating }: {
  params: NaiParams; onParams: (p: NaiParams) => void; rating: Rating; onRating: (r: Rating) => void;
}) {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState({ w: 1216, h: 2624 });
  useEffect(() => { setDevice(deviceSize(screen.width, screen.height, devicePixelRatio || 1)); }, []);

  const full = params.model === "nai-diffusion-5-full";
  const medium = full && params.effort === "medium";
  const steps = medium ? 14 : params.steps;
  const preset = matchPreset(params.width, params.height);
  const orientation: Orientation | null = preset?.orientation
    ?? (params.width === device.w && params.height === device.h ? "wallpaper" : null);
  const set = (patch: Partial<NaiParams>) => onParams({ ...params, ...patch });
  // Furry mode pairs with the Furry Focus UC preset (and back), as on NovelAI.
  const setMode = (mode: "anime" | "furry") => set({ mode, ucPreset: mode === "furry" ? "furry" : params.ucPreset === "furry" ? "heavy" : params.ucPreset });
  const free = isFree({ ...params, steps });
  // Compact on purpose: it has to fit beside the SFW/NSFW switch on a phone.
  const summary = [full ? "Full" : "Curated", params.mode === "furry" ? "Furry" : "Anime", full ? (medium ? "Med" : "High") : null,
    `${params.width}×${params.height}`, `${steps}st`, `cfg${params.scale}`].filter(Boolean).join(" · ");
  const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <RatingSwitch rating={rating} onRating={onRating} />
        <button type="button" onClick={() => setOpen(true)} aria-label={`Generation settings: ${summary}`}
          className="border-border bg-surface flex min-h-10 min-w-0 flex-1 items-center gap-1 rounded-md border px-2.5 py-1 text-left">
          <span className="line-clamp-2 min-w-0 flex-1 font-mono text-[11px] leading-tight">{summary}</span>
          <span className={`shrink-0 font-mono text-[10px] ${free ? "text-ok" : "text-warn"}`}>{free ? "free" : "Anlas"}</span>
          <Chevron className="text-muted size-4 shrink-0" />
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} label="Generation settings" closeLabel="Close generation settings"
        className="max-h-[92dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="flex-1 text-base font-semibold">Generation</h2>
          <span className={`rounded-full px-2 py-1 font-mono text-[11px] ${free ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>{free ? "free · Opus" : "costs Anlas"}</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
          <section className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <h3 className={h3}>Model</h3>
              <div role="radiogroup" aria-label="Model" className="border-border grid grid-cols-2 overflow-hidden rounded-md border">
                {MODELS.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={params.model === m.id} onClick={() => set({ model: m.id })} className={seg(params.model === m.id)}>{m.label}</button>
                ))}
              </div>
            </div>
            <div>
              <h3 className={h3}>Mode</h3>
              <div role="radiogroup" aria-label="Mode" className="border-border grid grid-cols-2 overflow-hidden rounded-md border">
                {(["anime", "furry"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={(params.mode ?? "anime") === m} onClick={() => setMode(m)} className={`${seg((params.mode ?? "anime") === m)} capitalize`}>{m}</button>
                ))}
              </div>
            </div>
            <div>
              <h3 className={h3}>Effort</h3>
              <div role="radiogroup" aria-label="Effort" className={`border-border grid grid-cols-2 overflow-hidden rounded-md border ${full ? "" : "opacity-40"}`}>
                {(["medium", "high"] as const).map((e) => (
                  <button key={e} type="button" role="radio" disabled={!full} aria-checked={(params.effort ?? "high") === e} onClick={() => set({ effort: e })} className={`${seg((params.effort ?? "high") === e)} capitalize`}>{e}</button>
                ))}
              </div>
            </div>
            {!full && <p className="text-faint col-span-2 text-xs">Effort applies to V5 Full only.</p>}
            {medium && <p className="text-muted col-span-2 text-xs">Medium: ~40% cheaper, fixed 14 steps, Euler Ancestral and the Heavy preset. Undesired content isn't sent — pull unwanted things below 0 on a line instead.</p>}
          </section>

          <section>
            <h3 className={h3}>Canvas</h3>
            <div role="radiogroup" aria-label="Orientation" className="grid grid-cols-4 gap-2">
              {ORIENTATIONS.map(([o, label]) => {
                const s = o === "wallpaper" ? PRESETS.wallpaper[1] : PRESETS[o][1];
                const k = 28 / Math.max(s.w, s.h);
                return (
                  <button key={o} type="button" role="radio" aria-checked={orientation === o} onClick={() => set({ width: s.w, height: s.h })}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] ${orientation === o ? "border-accent text-fg" : "border-border text-muted"}`}>
                    <span aria-hidden="true" className="grid h-8 place-items-center"><span className="border-current rounded-[3px] border-2" style={{ width: s.w * k, height: s.h * k }} /></span>
                    {label}<span className="text-faint font-mono text-[10px]">{ratioLabel(s.w, s.h)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(orientation && orientation !== "wallpaper" ? PRESETS[orientation] : PRESETS.wallpaper).map((s) => (
                <button key={s.name} type="button" onClick={() => set({ width: s.w, height: s.h })}
                  className={`rounded-full border px-3 py-1.5 font-mono text-xs ${params.width === s.w && params.height === s.h ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-muted"}`}>
                  {s.name} {s.w}×{s.h}
                </button>
              ))}
              <button type="button" onClick={() => set({ width: device.w, height: device.h })} title="This device's native screen size (costs Anlas)"
                className={`rounded-full border px-3 py-1.5 font-mono text-xs ${params.width === device.w && params.height === device.h ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-muted"}`}>
                Device {device.w}×{device.h}
              </button>
            </div>
            <div className="mt-3 flex items-end gap-2">
              <label className="text-muted flex-1 text-xs">Width
                <input type="number" step={64} min={64} value={params.width} onChange={(e) => set({ width: Number(e.target.value) || params.width })}
                  onBlur={() => set({ width: Math.max(64, Math.round(params.width / 64) * 64) })} className={`${field} mt-1 w-full`} />
              </label>
              <button type="button" onClick={() => { const r = rotate({ w: params.width, h: params.height }); set({ width: r.w, height: r.h }); }}
                aria-label="Rotate canvas (swap width and height)" className="border-border text-muted grid size-11 place-items-center rounded-md border"><Rotate className="size-5" /></button>
              <label className="text-muted flex-1 text-xs">Height
                <input type="number" step={64} min={64} value={params.height} onChange={(e) => set({ height: Number(e.target.value) || params.height })}
                  onBlur={() => set({ height: Math.max(64, Math.round(params.height / 64) * 64) })} className={`${field} mt-1 w-full`} />
              </label>
            </div>
            <p className="text-faint mt-1 font-mono text-[11px]">{ratioLabel(params.width, params.height)} · {(params.width * params.height / 1e6).toFixed(2)} Mpx{preset ? ` · ${preset.size}` : orientation === "wallpaper" ? " · Device" : " · Custom"}</p>
          </section>

          <section className="space-y-4">
            <h3 className={h3}>Sampling</h3>
            <SliderField label="Steps" min={0} max={50} step={1} value={steps} disabled={medium} hint={steps <= 28 ? "≤28 free" : "costs Anlas"} onChange={(v) => set({ steps: v })} />
            <SliderField label="Prompt guidance" min={0} max={10} step={0.1} value={params.scale} onChange={(v) => set({ scale: v })} />
            <SliderField label="Prompt guidance rescale" min={0} max={1} step={0.02} value={medium ? 0 : params.cfgRescale} disabled={medium} onChange={(v) => set({ cfgRescale: v })} />
          </section>

          <section>
            <h3 className={h3}>Seed</h3>
            <div className="relative">
              <input aria-label="Seed (blank = random)" type="number" inputMode="numeric" placeholder="random each time" value={params.seed ?? ""}
                onChange={(e) => set({ seed: e.target.value === "" ? undefined : Number(e.target.value) })} className={`${field} w-full pr-12`} />
              {params.seed !== undefined && (
                <button type="button" onClick={() => set({ seed: undefined })} aria-label="Clear seed (random)"
                  className="text-muted absolute inset-y-0 right-0 grid w-11 place-items-center"><ClearCircle className="size-5" /></button>
              )}
            </div>
          </section>

          <details className="group">
            <summary className="text-muted cursor-pointer list-none text-xs font-medium tracking-wide uppercase">Advanced <span className="group-open:hidden">›</span></summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-muted text-xs">Sampler
                <select value={medium ? "k_euler_ancestral" : params.sampler} disabled={medium} onChange={(e) => onParams(fixSchedule({ ...params, sampler: e.target.value }))} className={`${field} mt-1 w-full disabled:opacity-50`}>
                  {SAMPLERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-muted text-xs">Noise schedule
                <select value={params.noiseSchedule} onChange={(e) => set({ noiseSchedule: e.target.value })} className={`${field} mt-1 w-full`}>
                  {schedulesFor(params.sampler).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-muted text-xs">Quality tags
                <select value={params.quality ?? "standard"} onChange={(e) => set({ quality: e.target.value as Quality })} className={`${field} mt-1 w-full`}>
                  <option value="standard">Standard</option><option value="light">Light</option><option value="off">Off</option>
                </select>
              </label>
              <label className="text-muted text-xs">UC preset
                <select value={medium ? "heavy" : params.ucPreset ?? "heavy"} disabled={medium} onChange={(e) => set({ ucPreset: e.target.value as UcPreset })} className={`${field} mt-1 w-full disabled:opacity-50`}>
                  <option value="heavy">Heavy</option><option value="light">Light</option><option value="human">Human focus</option><option value="furry">Furry focus</option><option value="none">None</option>
                </select>
              </label>
            </div>
          </details>
        </div>
      </Sheet>
    </>
  );
}
