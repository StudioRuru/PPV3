"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadDraft, saveDraft } from "@/lib/draft";
import { DEFAULT_PARAMS, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { applyTags, emptyState, type PromptState } from "@/lib/prompt";
import { DEFAULT_ENABLED, DEFAULT_EXCLUDE, filterTags, type RawTag } from "@/lib/tagger";

type TagResponse = {
  tags: RawTag[]; thresholds: Record<string, number>; ms: number;
  recipe: null | { state: PromptState; params: Partial<NaiParams> };
};
const CATEGORIES = [
  ["character", "Character"], ["copyright", "Series"], ["general", "General"],
  ["style", "Artist"], ["meta", "Meta"], ["rating", "Rating"],
] as const;

export default function Tagger() {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<TagResponse | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [exclude, setExclude] = useState(DEFAULT_EXCLUDE.join(", "));
  const [target, setTarget] = useState<"base" | number>(0);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = useMemo(
    () => (res ? filterTags(res.tags, { thresholds, enabled, exclude: exclude.split(",") }).join(", ") : ""),
    [res, thresholds, enabled, exclude],
  );

  async function analyze(file: File) {
    setPreview(URL.createObjectURL(file)); setBusy(true); setError(null); setRes(null);
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<TagResponse>("/api/tag", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRes(r.data); setThresholds(r.data.thresholds);
  }

  function send() {
    const d = loadDraft() ?? { state: emptyState(), params: DEFAULT_PARAMS };
    saveDraft({ ...d, state: applyTags({ ...emptyState(), ...d.state }, target, mode, text) });
    router.push("/");
  }

  function loadRecipe() {
    if (!res?.recipe) return;
    saveDraft({ state: res.recipe.state, params: { ...DEFAULT_PARAMS, ...res.recipe.params } });
    router.push("/");
  }

  const field = "bg-bg border-border rounded-md border px-2 py-2 text-base";
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyze(f); }}>
      <section className="space-y-3">
        <label className="border-border bg-surface grid min-h-48 cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Image to tag" className="max-h-96 w-full object-contain" /> : <span className="text-muted p-6 text-center text-sm">Tap to choose an image, or drop one here</span>}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
        </label>
        {busy && <p className="text-muted text-sm" role="status">Analyzing…</p>}
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        {res && <p className="text-muted text-xs">{res.tags.length} candidates · {res.ms} ms</p>}
        {res?.recipe && (
          <div className="bg-surface border-border flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>NovelAI recipe found in this image.</span>
            <button type="button" onClick={loadRecipe} className="text-accent font-semibold">Load recipe</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <fieldset className="bg-surface border-border space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Categories &amp; thresholds</legend>
          {CATEGORIES.map(([key, label]) => (
            <div key={key} className="flex items-center gap-3 text-sm">
              <label className="flex w-28 items-center gap-2">
                <input type="checkbox" checked={enabled[key]} onChange={(e) => setEnabled({ ...enabled, [key]: e.target.checked })} />
                {label}
              </label>
              <input type="range" min="0.05" max="1" step="0.01" aria-label={`${label} threshold`} value={thresholds[key] ?? 0.2}
                onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })} className="flex-1 accent-[var(--color-accent)]" />
              <span className="text-muted w-10 text-right tabular-nums">{(thresholds[key] ?? 0.2).toFixed(2)}</span>
            </div>
          ))}
          <label className="block text-sm">
            <span className="text-muted">Exclude</span>
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} className={`${field} mt-1 w-full`} />
          </label>
        </fieldset>

        <textarea readOnly value={text} rows={8} aria-label="Tag result" className={`${field} w-full`} />
        <p className="text-muted text-xs">{text ? text.split(", ").length : 0} tags</p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-label="Send to" value={String(target)} onChange={(e) => setTarget(e.target.value === "base" ? "base" : Number(e.target.value))} className={field}>
            <option value="base">Base prompt</option>
            {[0, 1, 2, 3].map((i) => <option key={i} value={i}>Character {i + 1}</option>)}
          </select>
          <div role="radiogroup" aria-label="Send mode" className="border-border flex overflow-hidden rounded-md border">
            {(["replace", "append"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`px-3 py-2 capitalize ${mode === m ? "bg-accent text-accent-fg" : ""}`}>{m}</button>
            ))}
          </div>
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)} disabled={!text} className="text-accent px-2 py-2 disabled:opacity-40">Copy</button>
          <button type="button" onClick={send} disabled={!text}
            className="bg-accent text-accent-fg ml-auto rounded-lg px-5 py-3 font-semibold disabled:opacity-40">Send to Studio</button>
        </div>
      </section>
    </main>
  );
}
