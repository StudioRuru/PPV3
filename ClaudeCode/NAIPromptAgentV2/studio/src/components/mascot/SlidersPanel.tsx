"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dragSlider, driftNote, sliderCaption, SLIDERS, type Slider, type SliderId, type Sliders } from "@/lib/mascot/slime";
import { requestSeq } from "@/lib/mascot/ui";
import { requestJson } from "@/lib/net";

type Listing = { empty: boolean; sliders: Sliders; heatDrift: boolean };
const LABELS: Record<SliderId, string> = { brat: "Brat", tease: "Tease", flirt: "Flirt", bimbo: "Bimbofication", hypnosis: "Hypnosis", heat: "Heat", length: "Speech length" };
const API = "/api/mascot/slimes";
const post = (body: object) => requestJson<Listing>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const step = "border-border size-11 shrink-0 rounded-md border text-base disabled:opacity-40";

/** Miyabi's personality sliders (value + cap) and the heat-drift toggle, for the active slime. Saves on release, one slider at a time. */
export function SlidersPanel({ open = true }: { open?: boolean }) {
  const [data, setData] = useState<Listing | null>(null);
  const [drag, setDragState] = useState<{ id: SliderId; s: Slider } | null>(null);
  const dragRef = useRef(drag); // release can fire twice (pointerup + touchend) in one tick: read/clear synchronously
  const setDrag = (v: typeof drag) => { dragRef.current = v; setDragState(v); };
  const [errors, setErrors] = useState<Partial<Record<SliderId | "heat-drift", string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seq] = useState(requestSeq); // only the newest response is applied
  const [me] = useState(() => ({})); // tags our own "mascot:identity" so we don't refetch on it

  const load = useCallback(async () => {
    if (seq.busy()) return; // a save in flight brings back a fresh listing itself
    const n = seq.start();
    const r = await requestJson<Listing>(API);
    if (!seq.done(n)) return;
    if (r.ok) { setData(r.data); setLoadError(null); } else setLoadError(r.error);
  }, [seq]);

  useEffect(() => {
    if (!open) return;
    load();
    const on = (e: Event) => { if ((e as CustomEvent).detail !== me) load(); }; // shelf/other panels changed who she is
    window.addEventListener("mascot:identity", on);
    return () => window.removeEventListener("mascot:identity", on);
  }, [open, load, me]);

  if (!data) return loadError
    ? <p role="alert" className="text-danger flex items-center gap-2 text-xs">{loadError}<button type="button" onClick={load} className="border-border text-fg min-h-11 rounded-md border px-3">Retry</button></p>
    : <p className="text-faint text-xs">Loading…</p>;
  const d = data;

  /** POST one change; optimistic, reverted (with an inline error under `key`) on failure. */
  async function send(key: SliderId | "heat-drift", optimistic: Listing, body: object) {
    const before = d;
    setData(optimistic);
    const n = seq.start();
    const r = await post(body);
    const latest = seq.done(n); // an older response landing late must not overwrite a newer one
    if (!r.ok) {
      setErrors((e) => ({ ...e, [key]: r.error }));
      if (latest) { setData(before); load(); } // revert, then resync with the server
      return;
    }
    setErrors((e) => ({ ...e, [key]: undefined }));
    if (latest) setData(r.data);
    window.dispatchEvent(new CustomEvent("mascot:identity", { detail: me }));
  }
  function commit(id: SliderId, field: "value" | "cap", s: Slider) {
    setDrag(null);
    if (s[field] === d.sliders[id][field] && d.sliders[id].live === undefined) return;
    send(id, { ...d, sliders: { ...d.sliders, [id]: s } }, { action: "sliders", slider: id, [field]: s[field] });
  }
  const release = () => { const g = dragRef.current; if (g) commit(g.id, "value", g.s); };

  return (
    <div className="space-y-2">
      {d.empty && <p className="text-muted text-sm">No slime inserted — she&apos;s empty.</p>}
      {SLIDERS.map((id) => {
        const s = drag?.id === id ? drag.s : d.sliders[id];
        const drift = driftNote(s);
        return (
          <div key={id} className="text-sm">
            <p className="flex items-baseline justify-between gap-2">
              <span>{LABELS[id]} <span className="text-muted text-xs">{sliderCaption(id, s.value)}</span></span>
              {drift && <span className="text-accent font-mono text-[11px]">{drift}</span>}
            </p>
            <div className="flex items-center gap-1">
              <input type="range" min={0} max={10} step={1} value={s.value} disabled={d.empty}
                aria-label={`${LABELS[id]} level`} aria-valuetext={`${s.value} — ${sliderCaption(id, s.value)}`}
                onChange={(e) => setDrag({ id, s: dragSlider(s, "value", Number(e.target.value)) })}
                onPointerUp={release} onPointerCancel={release} onTouchEnd={release} onKeyUp={release} onBlur={release}
                className="accent-accent h-11 min-w-0 flex-1 disabled:opacity-40" />
              <span className="text-muted w-5 text-right font-mono text-xs">{s.value}</span>
              <button type="button" disabled={d.empty || s.cap <= 0} aria-label={`Lower ${LABELS[id]} cap`}
                onClick={() => commit(id, "cap", dragSlider(s, "cap", s.cap - 1))} className={step}>−</button>
              <span className="text-muted w-10 text-center font-mono text-[11px] leading-tight">cap<br />{s.cap}</span>
              <button type="button" disabled={d.empty || s.cap >= 10} aria-label={`Raise ${LABELS[id]} cap`}
                onClick={() => commit(id, "cap", dragSlider(s, "cap", s.cap + 1))} className={step}>+</button>
            </div>
            {errors[id] && <p role="alert" className="text-danger text-xs">{errors[id]}</p>}
          </div>
        );
      })}
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span>Heat drift<span className="text-muted block text-xs">Her heat may creep up to its cap on its own</span></span>
        <input type="checkbox" role="switch" checked={d.heatDrift} disabled={d.empty} className="accent-accent size-5"
          onChange={(e) => send("heat-drift", { ...d, heatDrift: e.target.checked }, { action: "heatDrift", on: e.target.checked })} />
      </label>
      {errors["heat-drift"] && <p role="alert" className="text-danger text-xs">{errors["heat-drift"]}</p>}
    </div>
  );
}
