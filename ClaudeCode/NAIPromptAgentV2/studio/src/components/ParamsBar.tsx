"use client";
import { isFree } from "@/lib/grid";
import { MODELS, type NaiParams } from "@/lib/nai-body";
import type { Rating } from "@/lib/prompt";

export function ParamsBar({ params, onParams, rating, onRating }: {
  params: NaiParams; onParams: (p: NaiParams) => void; rating: Rating; onRating: (r: Rating) => void;
}) {
  const num = (k: keyof NaiParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onParams({ ...params, [k]: e.target.value === "" ? undefined : Number(e.target.value) });
  const field = "bg-bg border-border rounded-md border px-2 py-2 text-base";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={params.model} onChange={(e) => onParams({ ...params, model: e.target.value })} className={field}>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div role="radiogroup" aria-label="Rating" className="border-border flex overflow-hidden rounded-md border">
        {(["safe", "nsfw", "off"] as Rating[]).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={rating === r} onClick={() => onRating(r)}
            className={`px-3 py-2 uppercase ${rating === r ? "bg-accent text-accent-fg" : ""}`}>{r}</button>
        ))}
      </div>
      <input aria-label="Width" type="number" step="64" value={params.width} onChange={num("width")} className={`${field} w-20`} />
      <span>×</span>
      <input aria-label="Height" type="number" step="64" value={params.height} onChange={num("height")} className={`${field} w-20`} />
      <input aria-label="Steps" type="number" value={params.steps} onChange={num("steps")} className={`${field} w-16`} />
      <input aria-label="Guidance" type="number" step="0.1" value={params.scale} onChange={num("scale")} className={`${field} w-16`} />
      <input aria-label="Seed (blank = random)" type="number" placeholder="random seed" value={params.seed ?? ""} onChange={num("seed")} className={`${field} w-36`} />
      {!isFree(params) ? <span className="text-danger">costs Anlas</span> : null}
    </div>
  );
}
