"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import type { PromptState } from "@/lib/prompt";
import { chipsToText, DEFAULT_EXCLUDE, filterTags, type ChipState, type Preset, type RawTag } from "@/lib/tagger";
import { TagChip } from "./TagChip";

type TagResponse = { tags: RawTag[]; thresholds: Record<string, number>; ms: number; recipe: null | { state: PromptState; params: Partial<NaiParams> } };
type Target = "base" | number | "new";

function targetAt(x: number, y: number): { el: HTMLElement; target: Target } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const v = el.dataset.drop!;
  return { el, target: v === "base" || v === "new" ? v : Number(v.split(":")[1]) };
}

export function TaggerPane({ preset, onTagged, onDrop, onRecipe, onText }: {
  preset: Preset; onTagged: (n: number) => void;
  onDrop: (text: string, target: Target) => void;
  onRecipe: (r: { state: PromptState; params: Partial<NaiParams> }) => void;
  onText: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<TagResponse | null>(null);
  const [chips, setChips] = useState<ChipState>({});
  const [view, setView] = useState<"chips" | "text">("chips");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ tag: string; x: number; y: number } | null>(null);
  const hover = useRef<HTMLElement | null>(null);
  const latest = useRef(0);

  const tags = useMemo(() => (res ? filterTags(res.tags, {
    thresholds: { ...res.thresholds, ...preset.thresholds },
    enabled: preset.enabled, exclude: preset.exclude ?? DEFAULT_EXCLUDE, groups: preset.groups,
  }) : []), [res, preset]);
  const text = chipsToText(tags, chips);
  useEffect(() => { onText(text); }, [text, onText]);

  async function analyze(file: File) {
    const id = ++latest.current;
    setPreview(URL.createObjectURL(file)); setBusy(true); setError(null); setRes(null); setChips({}); setOpen(true);
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<TagResponse>("/api/tag", { method: "POST", body: fd });
    if (id !== latest.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRes(r.data);
    onTagged(r.data.tags.length);
  }

  const setHover = (el: HTMLElement | null) => {
    if (hover.current === el) return;
    hover.current?.removeAttribute("data-drop-hover");
    el?.setAttribute("data-drop-hover", "");
    hover.current = el;
  };

  // Split desk: the pane stays pinned while the prompt scrolls under it, so chips and drop targets share the screen.
  return (
    <section aria-label="Tagger" className="bg-surface border-border sticky top-0 z-20 rounded-lg border shadow-lg">
      <header className="flex items-center gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="Image being tagged" className="h-16 w-12 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Tagger</h2>
          <p className="text-muted truncate text-xs" role="status">
            {busy ? "Analyzing…" : res ? `${tags.length} tags · ${res.ms} ms · drag onto the prompt` : "Add an image to tag it"}
          </p>
        </div>
        <label className="border-border cursor-pointer rounded-md border px-3 py-2 text-sm">
          {preview ? "New image" : "Add image"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analyze(f); }} />
        </label>
        <button type="button" aria-expanded={open} aria-label={open ? "Collapse tagger" : "Expand tagger"} onClick={() => setOpen(!open)}
          className="border-border size-11 rounded-md border">{open ? "–" : "+"}</button>
      </header>

      {open && (
        <div className="border-border space-y-3 border-t p-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyze(f); }}>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {res?.recipe && (
            <button type="button" className="text-accent text-sm" onClick={() => onRecipe(res.recipe!)}>NovelAI recipe found · load it</button>
          )}
          {res && (
            <div role="radiogroup" aria-label="Result view" className="border-border inline-flex overflow-hidden rounded-md border text-xs">
              {(["chips", "text"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 capitalize ${view === v ? "bg-surface-2 text-fg" : "text-muted"}`}>{v}</button>
              ))}
            </div>
          )}
          {res && view === "chips" && (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
              {tags.map((t) => (
                <TagChip key={t} tag={t} dropped={!!chips[t]?.dropped} weight={chips[t]?.weight}
                  onToggle={() => setChips({ ...chips, [t]: { ...chips[t], dropped: !chips[t]?.dropped } })}
                  onBoost={() => setChips({ ...chips, [t]: { ...chips[t], dropped: false, weight: chips[t]?.weight ? undefined : 1.15 } })}
                  onDragMove={(x, y) => { setGhost({ tag: t, x, y }); setHover(targetAt(x, y)?.el ?? null); }}
                  onDragEnd={(x, y) => {
                    setGhost(null); setHover(null);
                    const hit = targetAt(x, y);
                    if (hit) onDrop(chips[t]?.weight ? `${chips[t].weight}::${t}::` : t, hit.target);
                  }} />
              ))}
            </div>
          )}
          {res && view === "text" && <textarea readOnly value={text} rows={4} aria-label="Kept tags" className="bg-bg border-border w-full rounded-md border p-2 text-base" />}
          {res && (
            <div className="flex gap-2">
              <button type="button" data-drop="base" onClick={() => onDrop(text, "base")} disabled={!text}
                className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm disabled:opacity-40">All → Base</button>
              <button type="button" data-drop="new" onClick={() => onDrop(text, "new")} disabled={!text}
                className="border-border flex-1 rounded-md border px-3 py-2.5 text-sm disabled:opacity-40">All → new character</button>
            </div>
          )}
        </div>
      )}

      {ghost && (
        <span aria-hidden="true" className="bg-surface-2 border-accent pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-md border px-2.5 py-1.5 text-sm shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}>{ghost.tag}</span>
      )}
    </section>
  );
}
