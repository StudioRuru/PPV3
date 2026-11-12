"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import type { Line, PromptState } from "@/lib/prompt";
import { chipsToText, DEFAULT_EXCLUDE, dragText, keepTags, toPromptTag, type ChipState, type Preset, type RawTag } from "@/lib/tagger";
import { TagChip } from "./TagChip";

type TagResponse = { tags: RawTag[]; thresholds: Record<string, number>; ms: number; recipe: null | { state: PromptState; params: Partial<NaiParams> } };
type Target = "base" | number | "new";

function targetAt(x: number, y: number): { el: HTMLElement; target: Target } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const v = el.dataset.drop!;
  return { el, target: v === "base" || v === "new" ? v : Number(v.split(":")[1]) };
}

export function TaggerPane({ preset, onTagged, onDrop, onRecipe, onText, onScene, onRecreate, onCharacters, incoming }: {
  preset: Preset; onTagged: (n: number) => void;
  onDrop: (text: string, target: Target) => void;
  onRecipe: (r: { state: PromptState; params: Partial<NaiParams> }) => void;
  onText: (text: string) => void;
  onScene: (file: File, tags: string) => void;
  onRecreate: (tags: RawTag[]) => void;
  /** Per-character read: known tags as lines, unknown features as optional (off) lines. */
  onCharacters: (r: { base: Line[]; chars: Line[][] }) => void;
  /** A file handed in from outside (iOS share sheet / native import): tagged as if picked here. */
  incoming?: File | null;
}) {
  const [open, setOpen] = useState(true);
  const [stuck, setStuck] = useState(false); // pinned under the island: compact header so the prompt keeps the screen
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = self.current;
    if (!el) return;
    const check = () => setStuck(el.getBoundingClientRect().top <= parseFloat(getComputedStyle(el).top) + 1 && window.scrollY > 0);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<TagResponse | null>(null);
  const [chips, setChips] = useState<ChipState>({});
  const [view, setView] = useState<"chips" | "text">("chips");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ tag: string; x: number; y: number } | null>(null);
  const hover = useRef<HTMLElement | null>(null);
  const latest = useRef(0);
  const lastFile = useRef<File | null>(null);
  const [reading, setReading] = useState(false);

  async function readChars() {
    if (!lastFile.current) return;
    setReading(true); setError(null);
    const fd = new FormData(); fd.append("file", lastFile.current); fd.append("tags", text);
    const r = await requestJson<{ base: Line[]; chars: Line[][] }>("/api/tag/characters", { method: "POST", body: fd });
    setReading(false);
    if (r.ok) onCharacters(r.data); else setError(r.error);
  }

  const kept = useMemo(() => (res ? keepTags(res.tags, {
    thresholds: { ...res.thresholds, ...preset.thresholds },
    enabled: preset.enabled, exclude: preset.exclude ?? DEFAULT_EXCLUDE, groups: preset.groups,
  }) : []), [res, preset]);
  const tags = useMemo(() => kept.map(toPromptTag), [kept]);
  const text = chipsToText(tags, chips);
  useEffect(() => { onText(text); }, [text, onText]);

  async function analyze(file: File) {
    const id = ++latest.current;
    lastFile.current = file;
    setPreview(URL.createObjectURL(file)); setBusy(true); setError(null); setRes(null); setChips({}); setOpen(true);
    const fd = new FormData(); fd.append("file", file);
    const r = await requestJson<TagResponse>("/api/tag", { method: "POST", body: fd });
    if (id !== latest.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRes(r.data);
    onTagged(r.data.tags.length);
  }

  useEffect(() => {
    if (incoming) analyze(incoming);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per handed-in file
  }, [incoming]);

  const setHover = (el: HTMLElement | null) => {
    if (hover.current === el) return;
    hover.current?.removeAttribute("data-drop-hover");
    el?.setAttribute("data-drop-hover", "");
    hover.current = el;
  };

  // Split desk: the pane stays pinned while the prompt scrolls under it, so chips and drop targets share the screen.
  return (
    <section ref={self} aria-label="Tagger" data-noswipe className="bg-surface border-border sticky top-[calc(env(safe-area-inset-top)+var(--pt))] z-20 rounded-lg border shadow-lg">
      <header className={`flex items-center gap-3 transition-[padding] duration-200 ${stuck ? "px-3 py-1.5" : "p-3"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="Image being tagged" className={`${stuck ? "h-10 w-8" : "h-16 w-12"} rounded object-cover`} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Tagger</h2>
          <p className={`text-muted truncate text-xs ${stuck && !busy ? "sr-only" : ""}`} role="status">
            {busy ? "Analyzing…" : res ? `${tags.length} tags · ${res.ms} ms · drag onto the prompt` : "Add an image to tag it"}
          </p>
        </div>
        <label className="border-border cursor-pointer rounded-md border px-3 py-2 text-sm">
          {preview ? "New image" : "Add image"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analyze(f); }} />
        </label>
        {(res || error) && <button type="button" aria-expanded={open} aria-label={open ? "Collapse tagger" : "Expand tagger"} onClick={() => setOpen(!open)}
          className="border-border size-11 rounded-md border">{open ? "–" : "+"}</button>}
      </header>

      {open && (res || error) && (
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
              {tags.map((t, i) => (
                <TagChip key={t} tag={t} index={i} dropped={!!chips[t]?.dropped} weight={chips[t]?.weight}
                  onToggle={() => setChips({ ...chips, [t]: { ...chips[t], dropped: !chips[t]?.dropped } })}
                  onBoost={() => setChips({ ...chips, [t]: { ...chips[t], dropped: false, weight: chips[t]?.weight ? undefined : 1.15 } })}
                  onDragMove={(x, y) => { setGhost({ tag: t, x, y }); setHover(targetAt(x, y)?.el ?? null); }}
                  onDragEnd={(x, y) => {
                    setGhost(null); setHover(null);
                    const hit = targetAt(x, y);
                    const text = dragText(t, chips);
                    if (hit && text) onDrop(text, hit.target);
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
          {res && (
            // A NovelAI PNG carries its exact recipe: recreate from that, not from the tagger's guesses.
            <button type="button" disabled={!text && !res.recipe}
              onClick={() => res.recipe ? onRecipe(res.recipe) : onRecreate(kept.filter((t) => !chips[toPromptTag(t)]?.dropped).map((t) => ({ ...t, weight: chips[toPromptTag(t)]?.weight })))}
              className="bg-accent text-accent-fg w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-40">{res.recipe ? "Recreate from its NovelAI recipe" : "Recreate this image"}</button>
          )}
          {res && (
            // Tagger tags are image-wide; the brain splits them per character and notes extras (off, tinted) to opt into.
            <button type="button" disabled={reading} onClick={readChars}
              className="border-accent/50 text-accent w-full rounded-md border px-3 py-2.5 text-sm disabled:opacity-50">{reading ? "Reading characters… (up to a minute)" : "Read characters (split + optional extras)"}</button>
          )}
          {res && (
            <button type="button" onClick={() => lastFile.current && onScene(lastFile.current, text)}
              className="border-accent/50 text-accent w-full rounded-md border px-3 py-2.5 text-sm">Make this a scene (co-pilot)</button>
          )}
        </div>
      )}

      {ghost && (
        <span aria-hidden="true" className="bg-surface-2 border-accent pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] scale-110 rounded-md border px-2.5 py-1.5 text-sm shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}>{ghost.tag}</span>
      )}
    </section>
  );
}
