"use client";
import { useState } from "react";
import { isFree } from "@/lib/grid";
import { fixSchedule, MODELS, SAMPLERS, schedulesFor, type NaiParams, type Quality, type UcPreset } from "@/lib/nai-body";
import type { Rating } from "@/lib/prompt";

export function ParamsBar({ params, onParams, rating, onRating }: {
  params: NaiParams; onParams: (p: NaiParams) => void; rating: Rating; onRating: (r: Rating) => void;
}) {
  const num = (k: keyof NaiParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onParams({ ...params, [k]: e.target.value === "" ? undefined : Number(e.target.value) });
  const field = "bg-bg border-border rounded-md border px-2 py-2 font-mono text-base";
  const [more, setMore] = useState(false);
  const full = params.model === "nai-diffusion-5-full";
  const medium = full && params.effort === "medium";
  const nsfw = rating === "nsfw";
  const seg = (on: boolean) => `px-3 py-2 text-xs font-medium ${on ? "bg-accent text-accent-fg" : "text-muted"}`;
  // Furry mode pairs with the Furry Focus UC preset (and back), as on NovelAI.
  const setMode = (mode: "anime" | "furry") => onParams({ ...params, mode,
    ucPreset: mode === "furry" ? "furry" : params.ucPreset === "furry" ? "heavy" : params.ucPreset });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={params.model} onChange={(e) => onParams({ ...params, model: e.target.value })} className={field}>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {/* One tap toggles. NSFW puts "nsfw" first in the prompt; SFW puts it first in Undesired Content (NovelAI's own behaviour). */}
      <button type="button" role="switch" aria-checked={nsfw} aria-label="NSFW" onClick={() => onRating(nsfw ? "safe" : "nsfw")}
        className="border-border relative flex h-10 items-center overflow-hidden rounded-full border font-mono text-xs font-medium">
        <span className={`px-3 ${!nsfw ? "text-accent-fg" : "text-muted"} relative z-10`}>SFW</span>
        <span className={`px-3 ${nsfw ? "text-accent-fg" : "text-muted"} relative z-10`}>NSFW</span>
        <span aria-hidden="true" className={`bg-accent absolute inset-y-0 w-1/2 rounded-full transition-[translate] duration-200 ${nsfw ? "translate-x-full" : ""}`} />
      </button>
      <div role="radiogroup" aria-label="Mode" className="border-border flex overflow-hidden rounded-md border">
        {(["anime", "furry"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={(params.mode ?? "anime") === m} onClick={() => setMode(m)} className={`${seg((params.mode ?? "anime") === m)} capitalize`}>{m}</button>
        ))}
      </div>
      {full && (
        <div role="radiogroup" aria-label="Effort" className="border-border flex overflow-hidden rounded-md border">
          {(["high", "medium"] as const).map((e) => (
            <button key={e} type="button" role="radio" aria-checked={(params.effort ?? "high") === e} onClick={() => onParams({ ...params, effort: e })} className={`${seg((params.effort ?? "high") === e)} capitalize`}>{e}</button>
          ))}
        </div>
      )}
      <input aria-label="Width" type="number" step="64" value={params.width} onChange={num("width")} className={`${field} w-20`} />
      <span>×</span>
      <input aria-label="Height" type="number" step="64" value={params.height} onChange={num("height")} className={`${field} w-20`} />
      <input aria-label="Steps" type="number" value={medium ? 14 : params.steps} disabled={medium} onChange={num("steps")} className={`${field} w-16 disabled:opacity-50`} />
      <input aria-label="Guidance" type="number" step="0.1" value={params.scale} onChange={num("scale")} className={`${field} w-16`} />
      <input aria-label="Seed (blank = random)" type="number" placeholder="random seed" value={params.seed ?? ""} onChange={num("seed")} className={`${field} w-36`} />
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="text-accent px-1 py-2 text-sm">{more ? "Less" : "More"}</button>
      {medium && <p className="text-muted w-full text-xs">Medium effort: about 40% cheaper, fixed at 14 steps, Euler Ancestral and the Heavy UC preset. Undesired content isn't sent — use a negative weight on a line instead (e.g. a hat line at −3).</p>}
      {more && (
        <div className="bg-surface border-border grid w-full grid-cols-2 gap-2 rounded-lg border p-3">
          <label className="text-muted text-xs">Quality tags
            <select value={params.quality ?? "standard"} onChange={(e) => onParams({ ...params, quality: e.target.value as Quality })} className={`${field} mt-1 w-full`}>
              <option value="standard">Standard</option><option value="light">Light</option><option value="off">Off</option>
            </select>
          </label>
          <label className="text-muted text-xs">UC preset
            <select value={medium ? "heavy" : params.ucPreset ?? "heavy"} disabled={medium} onChange={(e) => onParams({ ...params, ucPreset: e.target.value as UcPreset })} className={`${field} mt-1 w-full disabled:opacity-50`}>
              <option value="heavy">Heavy</option><option value="light">Light</option><option value="human">Human focus</option><option value="furry">Furry focus</option><option value="none">None</option>
            </select>
          </label>
          <label className="text-muted text-xs">Sampler
            <select value={medium ? "k_euler_ancestral" : params.sampler} disabled={medium} onChange={(e) => onParams(fixSchedule({ ...params, sampler: e.target.value }))} className={`${field} mt-1 w-full`}>
              {SAMPLERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-muted text-xs">Noise schedule
            <select value={params.noiseSchedule} onChange={(e) => onParams({ ...params, noiseSchedule: e.target.value })} className={`${field} mt-1 w-full`}>
              {schedulesFor(params.sampler).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-muted col-span-2 text-xs">
            <span className="flex justify-between">Prompt guidance rescale<span className="text-fg font-mono">{params.cfgRescale.toFixed(2)}</span></span>
            <input type="range" min={0} max={1} step={0.02} value={medium ? 0 : params.cfgRescale} disabled={medium} onChange={(e) => onParams({ ...params, cfgRescale: Number(e.target.value) })}
              className="accent-accent mt-2 h-8 w-full" />
          </label>
        </div>
      )}
      {!isFree(params) ? <span className="text-danger">costs Anlas</span> : null}
    </div>
  );
}
