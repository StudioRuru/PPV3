"use client";
import { useState } from "react";
import { isFree } from "@/lib/grid";
import { fixSchedule, MODELS, SAMPLERS, schedulesFor, type NaiParams } from "@/lib/nai-body";
import type { Rating } from "@/lib/prompt";

export function ParamsBar({ params, onParams, rating, onRating }: {
  params: NaiParams; onParams: (p: NaiParams) => void; rating: Rating; onRating: (r: Rating) => void;
}) {
  const num = (k: keyof NaiParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onParams({ ...params, [k]: e.target.value === "" ? undefined : Number(e.target.value) });
  const field = "bg-bg border-border rounded-md border px-2 py-2 font-mono text-base";
  const [more, setMore] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={params.model} onChange={(e) => onParams({ ...params, model: e.target.value })} className={field}>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div role="radiogroup" aria-label="Rating" className="border-border flex overflow-hidden rounded-md border">
        {(["safe", "nsfw", "off"] as Rating[]).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={rating === r} onClick={() => onRating(r)}
            className={`px-3 py-2 font-mono text-xs font-medium uppercase ${rating === r ? "bg-accent text-accent-fg" : ""}`}>{r}</button>
        ))}
      </div>
      <input aria-label="Width" type="number" step="64" value={params.width} onChange={num("width")} className={`${field} w-20`} />
      <span>×</span>
      <input aria-label="Height" type="number" step="64" value={params.height} onChange={num("height")} className={`${field} w-20`} />
      <input aria-label="Steps" type="number" value={params.steps} onChange={num("steps")} className={`${field} w-16`} />
      <input aria-label="Guidance" type="number" step="0.1" value={params.scale} onChange={num("scale")} className={`${field} w-16`} />
      <input aria-label="Seed (blank = random)" type="number" placeholder="random seed" value={params.seed ?? ""} onChange={num("seed")} className={`${field} w-36`} />
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="text-accent px-1 py-2 text-sm">{more ? "Less" : "More"}</button>
      {more && (
        <div className="bg-surface border-border grid w-full grid-cols-2 gap-2 rounded-lg border p-3">
          <label className="text-muted text-xs">Sampler
            <select value={params.sampler} onChange={(e) => onParams(fixSchedule({ ...params, sampler: e.target.value }))} className={`${field} mt-1 w-full`}>
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
            <input type="range" min={0} max={1} step={0.02} value={params.cfgRescale} onChange={(e) => onParams({ ...params, cfgRescale: Number(e.target.value) })}
              className="accent-accent mt-2 h-8 w-full" />
          </label>
        </div>
      )}
      {!isFree(params) ? <span className="text-danger">costs Anlas</span> : null}
    </div>
  );
}
