"use client";
import { useEffect, useState } from "react";
import { dragSlider, driftNote, sliderCaption, SLIDERS, type Slider, type SliderId, type Sliders } from "@/lib/mascot/slime";
import { requestJson } from "@/lib/net";

type Listing = { empty: boolean; sliders: Sliders; heatDrift: boolean };
const LABELS: Record<SliderId, string> = { brat: "Brat", bimbo: "Bimbofication", hypnosis: "Hypnosis", heat: "Heat", length: "Speech length" };
const API = "/api/mascot/slimes";
const post = (body: object) => requestJson<Listing>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const step = "border-border size-11 shrink-0 rounded-md border text-base disabled:opacity-40";

/** Miyabi's five personality sliders (value + cap) and the heat-drift toggle, for the active slime. Saves on release, one slider at a time. */
export function SlidersPanel({ open = true }: { open?: boolean }) {
  const [data, setData] = useState<Listing | null>(null);
  const [drag, setDrag] = useState<{ id: SliderId; s: Slider } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SliderId | "heat-drift", string>>>({});

  useEffect(() => {
    if (!open) return;
    const load = () => requestJson<Listing>(API).then((r) => r.ok && setData(r.data));
    load();
    window.addEventListener("mascot:identity", load); // shelf/other panels changed who she is
    return () => window.removeEventListener("mascot:identity", load);
  }, [open]);

  if (!data) return <p className="text-faint text-xs">Loading…</p>;
  const d = data;

  /** POST one change; optimistic, reverted (with an inline error under `key`) on failure. */
  async function send(key: SliderId | "heat-drift", optimistic: Listing, body: object) {
    const before = d;
    setData(optimistic);
    const r = await post(body);
    if (!r.ok) { setData(before); setErrors((e) => ({ ...e, [key]: r.error })); return; }
    setErrors((e) => ({ ...e, [key]: undefined }));
    setData(r.data);
    window.dispatchEvent(new Event("mascot:identity"));
  }
  function commit(id: SliderId, field: "value" | "cap", s: Slider) {
    setDrag(null);
    if (s[field] === d.sliders[id][field] && d.sliders[id].live === undefined) return;
    send(id, { ...d, sliders: { ...d.sliders, [id]: s } }, { action: "sliders", slider: id, [field]: s[field] });
  }
  const release = () => { if (drag) commit(drag.id, "value", drag.s); };

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
                onPointerUp={release} onKeyUp={release} onBlur={release}
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
