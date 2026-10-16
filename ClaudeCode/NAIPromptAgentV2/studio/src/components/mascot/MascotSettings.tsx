"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Outfit } from "@/lib/mascot/core";
import { CAL_BOUNDS, CAL_ZERO, hasIsland, type Calibration } from "@/lib/mascot/island";
import type { MascotSettings as Settings } from "@/lib/mascot/settings";
import { cooldownLabel, cooldownToSlider, COOLDOWN_STEPS, sliderToCooldown } from "@/lib/mascot/ui";
import type { Fact } from "@/lib/mascot/store";
import { requestJson } from "@/lib/net";
import { useViewport } from "../LiquidIsland";
import { AutoTextarea } from "../TagInput";
import { SlidersPanel } from "./SlidersPanel";
import { SlimeShelf } from "./SlimeShelf";
import { SpriteStudio } from "./SpriteStudio";

// Over the wire "only when tapped" is null (JSON has no Infinity).
export type WireSettings = Omit<Settings, "cooldownMs"> & { cooldownMs: number | null };
type State = { settings: WireSettings; facts: Fact[] };

const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";
const row = "flex min-h-11 items-center justify-between gap-3 text-sm";
const select = "bg-bg border-border h-10 rounded-md border px-2 text-sm";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const post = (body: object) => requestJson<State>("/api/mascot/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Settings → Mascot: Miyabi's behaviour, memory and the sprite studio. */
export function MascotSettings({ open }: { open: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: number; text: string } | null>(null);
  const [forget, setForget] = useState(false);
  const [studio, setStudio] = useState(false);
  const [studioMounted, setStudioMounted] = useState(false); // portal needs document: mount on first open
  const [shelf, setShelf] = useState(false);
  const [shelfMounted, setShelfMounted] = useState(false);
  const [hidden, setHidden] = useState(false); // Miyabi swiped off / hidden: offer Summon
  const view = useViewport(); // island calibration only on Dynamic Island screens

  useEffect(() => {
    const on = (e: Event) => setHidden(!!(e as CustomEvent<{ hidden: boolean }>).detail?.hidden);
    window.addEventListener("mascot:hidden", on);
    return () => window.removeEventListener("mascot:hidden", on);
  }, []);

  useEffect(() => { if (open) requestJson<State>("/api/mascot/state").then((r) => r.ok && setState(r.data)); }, [open]);

  /** POST; null on success, else the error (and the optimistic change is rolled back to the server's state). */
  async function send(body: object): Promise<string | null> {
    const r = await post(body);
    if (!r.ok) {
      setError(r.error);
      requestJson<State>("/api/mascot/state").then((g) => g.ok && setState(g.data));
      return r.error;
    }
    setError(null);
    setState(r.data);
    window.dispatchEvent(new CustomEvent("mascot:settings", { detail: r.data.settings }));
    return null;
  }
  const save = (patch: Partial<WireSettings>) => {
    if (state) setState({ ...state, settings: { ...state.settings, ...patch } });
    return send({ settings: patch });
  };
  const [drag, setDrag] = useState<number | null>(null); // chattiness slider position while dragging; saved on release
  const commitSlider = () => { if (drag !== null) { save({ cooldownMs: sliderToCooldown(drag) }); setDrag(null); } };

  if (!state) return <section><h3 className={h3}>Mascot</h3><p className="text-faint text-xs">Loading…</p></section>;
  const s = state.settings;
  const slider = drag ?? cooldownToSlider(s.cooldownMs);

  return (
    <section className="space-y-1">
      <h3 className={h3}>Mascot</h3>
      <label className={row}>
        <span>Show Miyabi<span className="text-muted block text-xs">Floats in a corner on every tab</span></span>
        <input type="checkbox" role="switch" checked={s.show} onChange={(e) => save({ show: e.target.checked })} className="accent-accent size-5" />
      </label>
      <label className="block py-1 text-sm">
        <span className="flex justify-between">Chattiness<span className="text-muted font-mono text-xs">{cooldownLabel(sliderToCooldown(slider))}</span></span>
        <input type="range" min={0} max={COOLDOWN_STEPS.length} step={1} value={slider} aria-valuetext={cooldownLabel(sliderToCooldown(slider))}
          onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commitSlider} onKeyUp={commitSlider} onBlur={commitSlider} className="accent-accent mt-1 h-8 w-full" />
        <span className="text-faint flex justify-between text-[11px]"><span>Every 30 s</span><span>Only when tapped</span></span>
      </label>
      <div className={row}>
        <span>Night hours<span className="text-muted block text-xs">She switches to the night outfit</span></span>
        <span className="flex items-center gap-1">
          <select aria-label="Night from" value={s.nightFrom} onChange={(e) => save({ nightFrom: Number(e.target.value) })} className={select}>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          <span className="text-muted">–</span>
          <select aria-label="Night to" value={s.nightTo} onChange={(e) => save({ nightTo: Number(e.target.value) })} className={select}>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </span>
      </div>
      <div className="py-1">
        <p className="mb-1 text-sm">Outfit</p>
        <div role="radiogroup" aria-label="Outfit" className="border-border grid grid-cols-4 overflow-hidden rounded-md border">
          {([null, "day", "night", "lewd"] as (Outfit | null)[]).map((o) => (
            <button key={o ?? "auto"} type="button" role="radio" aria-checked={s.pin === o} onClick={() => save({ pin: o })}
              className={`h-11 text-xs font-medium capitalize ${s.pin === o ? "bg-accent text-accent-fg" : "text-muted"}`}>{o ?? "Auto"}</button>
          ))}
        </div>
      </div>
      <div className="py-1">
        <p className="mb-1 text-sm">Size</p>
        <div role="group" aria-label="Size" className="border-border grid grid-cols-3 overflow-hidden rounded-md border">
          {(["s", "m", "l"] as const).map((z) => (
            <button key={z} type="button" aria-pressed={s.size === z} onClick={() => save({ size: z })}
              className={`h-11 text-xs font-medium uppercase ${s.size === z ? "bg-accent text-accent-fg" : "text-muted"}`}>{z}</button>
          ))}
        </div>
      </div>
      <label className="block py-1 text-sm">
        <span className="flex justify-between">Mischief<span className="text-muted font-mono text-xs">{s.mischief}</span></span>
        <input type="range" min={0} max={10} step={1} value={s.mischief} onChange={(e) => save({ mischief: Number(e.target.value) })} className="accent-accent mt-1 h-8 w-full" />
        <span className="text-faint flex justify-between text-[11px]"><span>Stays put</span><span>Always in the way</span></span>
      </label>
      {view && hasIsland(view.top) && (
        <div className="py-1">
          <p className="flex items-center justify-between text-sm">Island
            <button type="button" onClick={() => save({ island: CAL_ZERO })} className="text-accent h-9 px-1 text-xs">Reset</button></p>
          <p className="text-faint mb-1 text-xs">Line the black drawer up with the real Dynamic Island (pt).</p>
          {(Object.keys(CAL_BOUNDS) as (keyof Calibration)[]).map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="text-muted w-20 text-xs">{{ x: "Left/right", y: "Up/down", w: "Width", h: "Height" }[k]}</span>
              <input type="range" min={CAL_BOUNDS[k][0]} max={CAL_BOUNDS[k][1]} step={1} value={s.island[k]} aria-label={`Island ${k}`}
                onChange={(e) => save({ island: { ...s.island, [k]: Number(e.target.value) } })} className="accent-accent h-8 flex-1" />
              <span className="text-muted w-8 text-right font-mono text-xs">{s.island[k]}</span>
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={() => window.dispatchEvent(new Event("mascot:hush"))} className="border-border min-h-11 rounded-md border px-3 py-2.5 text-sm">Hush 30 min</button>
        <button type="button" onClick={() => { setStudioMounted(true); setStudio(true); }} className="border-border min-h-11 rounded-md border px-3 py-2.5 text-sm">Sprite studio</button>
      </div>
      {hidden && <button type="button" onClick={() => window.dispatchEvent(new Event("mascot:summon"))} className="bg-accent text-accent-fg min-h-11 w-full rounded-md px-3 py-2.5 text-sm font-semibold">Summon Miyabi now</button>}
      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      <div className="pt-3">
        <h3 className={h3}>Personality</h3>
        <SlidersPanel open={open} />
        <label className={row}>
          <span>Unlock the slime shelf<span className="text-muted block text-xs">Save, swap and mix who she is, in jars</span></span>
          <input type="checkbox" role="switch" checked={s.shelf} onChange={(e) => save({ shelf: e.target.checked })} className="accent-accent size-5" />
        </label>
        {s.shelf && <button type="button" onClick={() => { setShelfMounted(true); setShelf(true); }} className="border-border min-h-11 w-full rounded-md border px-3 py-2.5 text-sm">Open slime shelf</button>}
      </div>

      <div className="pt-3">
        <p className="mb-1 text-sm">What she knows <span className="text-muted text-xs">({state.facts.length})</span></p>
        {!state.facts.length && <p className="text-faint text-xs">Nothing yet — she picks things up as you talk.</p>}
        <ul className="space-y-1">
          {state.facts.map((f) => (
            <li key={f.id} className="flex items-start gap-1 text-sm">
              {edit?.id === f.id ? (
                <>
                  <AutoTextarea value={edit.text} onChange={(text) => setEdit({ id: f.id, text })} className="flex-1 text-sm" />
                  <button type="button" onClick={() => setEdit(null)} className="text-muted min-h-11 px-2 text-xs">Cancel</button>
                  <button type="button" disabled={!edit.text.trim()}
                    onClick={async () => { if (!(await send({ facts: state.facts.map((x) => (x.id === f.id ? edit.text.trim() : x.text)) }))) setEdit(null); }}
                    className="text-accent min-h-11 px-2 text-xs font-semibold">Save</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEdit({ id: f.id, text: f.text })} className="flex-1 py-1.5 text-left" aria-label={`Edit: ${f.text}`}>{f.text}</button>
                  <button type="button" onClick={() => send({ deleteFact: f.id })} aria-label={`Delete: ${f.text}`} className="text-muted size-11 shrink-0">×</button>
                </>
              )}
            </li>
          ))}
        </ul>
        {forget ? (
          <div role="alertdialog" aria-label="Confirm forget" className="border-danger/40 bg-danger/10 mt-2 space-y-2 rounded-lg border p-3 text-sm">
            <p>Miyabi forgets <b>everything</b> she knows about you, for good.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForget(false)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
              <button type="button" onClick={async () => { await send({ clearFacts: true }); setForget(false); }}
                className="bg-danger flex-1 rounded-md px-3 py-2 font-semibold text-white">Forget everything</button>
            </div>
          </div>
        ) : state.facts.length > 0 && <button type="button" onClick={() => setForget(true)} className="text-danger min-h-11 text-xs">Forget everything she knows</button>}
      </div>

      {shelfMounted && createPortal(<SlimeShelf open={shelf} onClose={() => setShelf(false)} />, document.body)}
      {studioMounted && createPortal(<SpriteStudio open={studio} onClose={() => setStudio(false)} settings={s} onSave={save} />, document.body)}
    </section>
  );
}
