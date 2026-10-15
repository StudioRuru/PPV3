"use client";
import { useEffect, useRef, useState } from "react";
import type { Expression } from "@/lib/mascot/core";
import { isHex, mixError, PALETTE, ratioLabel, shelfRows, type JarInfo, type MixForm } from "@/lib/mascot/shelf";
import { requestJson } from "@/lib/net";
import { Avatar } from "../rp/RpScreen";
import { Sheet } from "../Sheet";
import { Jar } from "./Jar";

type Listing = { jars: JarInfo[]; active: number | null; empty: boolean };
type Say = { expression: Expression; text: string };
type Char = { id: number; name: string; avatarPath: string | null };
/** What the bottom panel shows: a jar's actions (and its rename/recolour/delete step), or a header flow. */
type Panel =
  | { kind: "jar"; id: number; step: "menu" | "rename" | "recolor" | "delete"; name: string; color: string }
  | { kind: "extract"; name: string; color: string }
  | { kind: "rp"; chars: Char[] | null; pick: number | null; name: string; color: string }
  | { kind: "mix"; form: MixForm }
  | null;

const API = "/api/mascot/slimes";
const post = (body: object) => requestJson<Listing & { quip?: Say }>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const btn = "border-border min-h-11 rounded-md border px-3 text-sm disabled:opacity-40";
const primary = "bg-accent text-accent-fg min-h-11 rounded-md px-3 text-sm font-semibold disabled:opacity-40";
const input = "bg-bg border-border h-11 w-full rounded-md border px-3 text-sm";
const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";

function ColorPick({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} onClick={() => onChange(c)}
          className={`size-11 rounded-full border-2 ${value === c ? "border-fg" : "border-transparent"}`} style={{ background: c }} />
      ))}
      <label className={`border-border relative flex size-11 items-center justify-center rounded-full border text-[10px] ${PALETTE.includes(value) ? "" : "border-fg border-2"}`}
        style={PALETTE.includes(value) ? undefined : { background: value }}>
        <span className={PALETTE.includes(value) ? "text-muted" : "sr-only"}>Custom</span>
        <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" className="absolute inset-0 opacity-0" />
      </label>
    </div>
  );
}

/** The slime shelf: Miyabi's saved identities as jars. Extract / remove / insert / mix / from RP / rename / recolour / delete. */
export function SlimeShelf({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Listing | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<{ id: number; text: string } | null>(null); // her last insert/remove line, under that jar
  const inFlight = useRef(false); // double taps land in the same tick, before `busy` renders

  const load = () => requestJson<Listing>(API).then((r) => { if (r.ok) setData(r.data); else setError(r.error); });
  useEffect(() => { if (open) { load(); setPanel(null); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One network action: buttons disabled while it runs; on success the fresh listing applies, else an inline error and a resync. */
  async function act(body: object, label: string, done?: (r: Listing & { quip?: Say }) => void): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(label); setError(null);
    const r = await post(body);
    inFlight.current = false; setBusy(null);
    if (!r.ok) { setError(r.error); load(); return false; }
    setData(r.data);
    done?.(r.data);
    window.dispatchEvent(new Event("mascot:identity"));
    return true;
  }
  const speak = (id: number) => (r: { quip?: Say }) => {
    if (!r.quip?.text) return;
    setLine({ id, text: r.quip.text });
    window.dispatchEvent(new CustomEvent("mascot:say", { detail: r.quip }));
  };

  const jars = data?.jars ?? [];
  const activeJar = jars.find((j) => j.active) ?? null;
  const nameOf = (id: number | "blank" | null) => (id === "blank" ? "Blank" : jars.find((j) => j.id === id)?.name ?? "?");
  const off = !!busy;

  function openJar(j: JarInfo) { setPanel({ kind: "jar", id: j.id, step: "menu", name: j.name, color: j.color }); setError(null); }
  function openMix(a: number | null) {
    const other = jars.find((j) => j.id !== a);
    setPanel({ kind: "mix", form: { a, b: other ? other.id : "blank", ratio: 50, name: "", color: PALETTE[(jars.length + 3) % PALETTE.length] } });
    setError(null);
  }
  async function openRp() {
    setPanel({ kind: "rp", chars: null, pick: null, name: "", color: PALETTE[(jars.length + 5) % PALETTE.length] }); setError(null);
    const r = await requestJson<{ characters: Char[] }>("/api/rp/characters");
    if (!r.ok) { setError(r.error); return; }
    setPanel((p) => (p?.kind === "rp" ? { ...p, chars: r.data.characters } : p));
  }

  function renderPanel() {
    if (!panel) return null;
    const close = <button type="button" onClick={() => setPanel(null)} disabled={off} className="text-muted min-h-11 px-2 text-sm">Close</button>;
    if (panel.kind === "jar") {
      const j = jars.find((x) => x.id === panel.id);
      if (!j) return null;
      const set = (p: Partial<typeof panel>) => setPanel({ ...panel, ...p });
      return (
        <>
          <div className="flex items-center gap-2"><h3 className="flex-1 truncate text-sm font-semibold">{j.name}{j.active && <span className="text-accent ml-2 text-xs font-normal">inside her</span>}</h3>{close}</div>
          {panel.step === "menu" && (
            <div className="grid grid-cols-2 gap-2">
              {j.active
                ? <button type="button" disabled={off} onClick={() => act({ action: "remove" }, "She's saying goodbye…", speak(j.id))} className={primary}>Remove</button>
                : <button type="button" disabled={off} onClick={() => act({ action: "insert", id: j.id }, "Waking her up…", speak(j.id))} className={primary}>Insert</button>}
              <button type="button" disabled={off} onClick={() => openMix(j.id)} className={btn}>Mix with…</button>
              <button type="button" disabled={off} onClick={() => set({ step: "rename" })} className={btn}>Rename</button>
              <button type="button" disabled={off} onClick={() => set({ step: "recolor" })} className={btn}>Recolour</button>
              <button type="button" disabled={off || j.active} onClick={() => set({ step: "delete" })} className={`${btn} text-danger col-span-2`}>
                {j.active ? "Delete (remove her first)" : "Delete"}
              </button>
            </div>
          )}
          {panel.step === "rename" && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: "rename", id: j.id, name: panel.name.trim() }, "Saving…", () => set({ step: "menu" })); }}>
              <input aria-label="Jar name" value={panel.name} maxLength={40} autoFocus onChange={(e) => set({ name: e.target.value })} className={input} />
              <button type="submit" disabled={off || !panel.name.trim() || panel.name.trim() === j.name} className={primary}>Save</button>
            </form>
          )}
          {panel.step === "recolor" && (
            <div className="space-y-2">
              <ColorPick value={panel.color} onChange={(color) => set({ color })} disabled={off} />
              <div className="flex gap-2">
                <button type="button" disabled={off} onClick={() => set({ step: "menu", color: j.color })} className={`${btn} flex-1`}>Cancel</button>
                <button type="button" disabled={off || !isHex(panel.color) || panel.color === j.color}
                  onClick={() => act({ action: "recolor", id: j.id, color: panel.color }, "Saving…", () => set({ step: "menu" }))} className={`${primary} flex-1`}>Save colour</button>
              </div>
            </div>
          )}
          {panel.step === "delete" && (
            <div role="alertdialog" aria-label="Confirm delete" className="border-danger/40 bg-danger/10 space-y-2 rounded-lg border p-3 text-sm">
              <p>Pour out <b>{j.name}</b> for good? Her voice, sliders and memories in this jar are lost.</p>
              <div className="flex gap-2">
                <button type="button" disabled={off} onClick={() => set({ step: "menu" })} className={`${btn} flex-1`}>Cancel</button>
                <button type="button" disabled={off} onClick={() => act({ action: "delete", id: j.id }, "Pouring out…", () => setPanel(null))}
                  className="bg-danger min-h-11 flex-1 rounded-md px-3 font-semibold text-white disabled:opacity-40">Delete</button>
              </div>
            </div>
          )}
        </>
      );
    }
    if (panel.kind === "extract") {
      const set = (p: Partial<typeof panel>) => setPanel({ ...panel, ...p });
      return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act({ action: "extract", name: panel.name.trim(), color: panel.color }, "Bottling…", () => setPanel(null)); }}>
          <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">Extract current</h3>{close}</div>
          <p className="text-muted text-xs">Saves who she is right now — live sliders and memories — as a new jar.</p>
          <input aria-label="Jar name" value={panel.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} className={input} />
          <ColorPick value={panel.color} onChange={(color) => set({ color })} disabled={off} />
          <button type="submit" disabled={off || !panel.name.trim()} className={`${primary} w-full`}>Bottle it</button>
        </form>
      );
    }
    if (panel.kind === "rp") {
      const set = (p: Partial<typeof panel>) => setPanel({ ...panel, ...p });
      const pick = panel.chars?.find((c) => c.id === panel.pick);
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">From RP character</h3>{close}</div>
          {!panel.chars ? <p className="text-faint text-xs">Loading…</p> : !panel.chars.length ? <p className="text-faint text-xs">No RP characters yet.</p> : (
            <ul role="listbox" aria-label="RP character" className="max-h-48 space-y-1 overflow-y-auto">
              {panel.chars.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={panel.pick === c.id} disabled={off} onClick={() => set({ pick: c.id, name: c.name.slice(0, 40) })}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${panel.pick === c.id ? "bg-accent-soft text-accent-ink" : ""}`}>
                    <Avatar c={c} size="size-9" /><span className="truncate">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pick && (
            <>
              <input aria-label="Jar name" value={panel.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} className={input} />
              <ColorPick value={panel.color} onChange={(color) => set({ color })} disabled={off} />
              <button type="button" disabled={off} onClick={() => act({ action: "fromRp", characterId: pick.id, name: panel.name.trim() || undefined, color: panel.color }, "brewing… (this can take a minute)", () => setPanel(null))}
                className={`${primary} w-full`}>Bottle {pick.name.slice(0, 24)}</button>
            </>
          )}
        </div>
      );
    }
    const f = panel.form;
    const set = (p: Partial<MixForm>) => setPanel({ kind: "mix", form: { ...f, ...p } });
    const problem = mixError(f);
    return (
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        if (!problem) act({ action: "mix", a: f.a, b: f.b, ratio: f.ratio, name: f.name.trim(), color: f.color }, "brewing… (this can take a minute)", () => setPanel(null));
      }}>
        <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">Mix</h3>{close}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">A
            <select value={f.a ?? ""} disabled={off} onChange={(e) => { const a = e.target.value ? Number(e.target.value) : null; set({ a, b: f.b === a ? "blank" : f.b }); }} className={input}>
              <option value="">Pick a jar</option>
              {jars.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </label>
          <label className="text-xs">B
            <select value={f.b ?? ""} disabled={off} onChange={(e) => set({ b: e.target.value === "blank" ? "blank" : e.target.value ? Number(e.target.value) : null })} className={input}>
              <option value="blank">Blank</option>
              {jars.filter((j) => j.id !== f.a).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-muted font-mono text-xs">{ratioLabel(f.ratio, nameOf(f.a), nameOf(f.b))}</span>
          <input type="range" min={10} max={90} step={5} value={f.ratio} disabled={off} aria-label="Mix ratio" aria-valuetext={ratioLabel(f.ratio, nameOf(f.a), nameOf(f.b))}
            onChange={(e) => set({ ratio: Number(e.target.value) })} className="accent-accent h-11 w-full" />
        </label>
        <input aria-label="New jar name" placeholder="Name the new jar" value={f.name} maxLength={40} disabled={off} onChange={(e) => set({ name: e.target.value })} className={input} />
        <ColorPick value={f.color} onChange={(color) => set({ color })} disabled={off} />
        <button type="submit" disabled={off || !!problem} className={`${primary} w-full`}>{busy ? busy : "Brew"}</button>
        {problem && !off && <p className="text-faint text-xs">{problem}</p>}
      </form>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} label="Slime shelf" closeLabel="Close slime shelf"
      className="h-[94dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-xl lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Slime shelf</h2>
        <button type="button" onClick={onClose} className="text-muted min-h-11 px-2 text-sm">Done</button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={off || !data || data.empty} className={btn}
            onClick={() => { setPanel({ kind: "extract", name: `${activeJar?.name ?? "Slime"} save`.slice(0, 40), color: activeJar?.color ?? PALETTE[0] }); setError(null); }}>Extract</button>
          <button type="button" disabled={off || !data} onClick={openRp} className={btn}>From RP</button>
          <button type="button" disabled={off || !jars.length} onClick={() => openMix(activeJar?.id ?? jars[0]?.id ?? null)} className={btn}>Mix</button>
        </div>
        {busy && <p role="status" className="text-accent text-sm"><span className="thinking mr-1" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span>{busy}</p>}
        {error && <p role="alert" className="text-danger text-xs">{error}</p>}

        {!data ? <p className="text-faint text-xs">Loading…</p> : (
          <div>
            <h3 className={h3}>{data.empty ? "She's empty — insert a jar" : `Inside her: ${activeJar?.name ?? "?"}`}</h3>
            {shelfRows(jars, data.empty).map((row, i) => (
              <div key={i} className="mb-4">
                <div className="grid grid-cols-3 gap-2 px-1">
                  {row.map((s) => s.kind === "empty" ? (
                    <div key="empty" className="flex flex-col items-center gap-1 pt-2">
                      <Jar color={null} />
                      <span className="text-faint text-xs">Empty</span>
                    </div>
                  ) : (
                    <button key={s.jar.id} type="button" disabled={off} onClick={() => openJar(s.jar)}
                      aria-label={`${s.jar.name}${s.jar.active ? " (inside her)" : ""}`} aria-pressed={panel?.kind === "jar" && panel.id === s.jar.id}
                      className={`flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-lg pt-2 ${panel?.kind === "jar" && panel.id === s.jar.id ? "bg-accent-soft" : ""}`}>
                      <Jar color={s.jar.color} active={s.jar.active} />
                      <span className="w-full truncate text-xs font-medium">{s.jar.name}</span>
                      {s.jar.active && <span className="bg-accent text-accent-fg rounded-full px-1.5 text-[10px] font-semibold">active</span>}
                      {line?.id === s.jar.id && <span aria-live="polite" className="text-muted line-clamp-3 text-[11px] italic">“{line.text}”</span>}
                    </button>
                  ))}
                </div>
                {/* the wooden plank */}
                <div aria-hidden="true" className="h-2.5 rounded-sm shadow-md" style={{ background: "linear-gradient(#8a5a34, #5a371d)" }} />
              </div>
            ))}
            {!jars.length && !data.empty && <p className="text-faint text-xs">No jars yet.</p>}
          </div>
        )}
      </div>
      {panel && <div className="border-border bg-surface max-h-[60%] space-y-2 overflow-y-auto border-t p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{renderPanel()}</div>}
    </Sheet>
  );
}
