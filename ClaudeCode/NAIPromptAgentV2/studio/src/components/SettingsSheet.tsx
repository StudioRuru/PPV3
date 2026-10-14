"use client";
import { useEffect, useState } from "react";
import { fixSchedule, SAMPLERS, schedulesFor, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { getTheme, setTheme, THEMES, type ThemePref } from "@/lib/theme";
import { Sheet } from "./Sheet";
import { useAnlas } from "./VariationSheet";

export const DEFAULTS_KEY = "studio-defaults-v1";
export type GenDefaults = Pick<NaiParams, "sampler" | "noiseSchedule" | "cfgRescale">;

/** Per-device generation defaults (storage may be blocked: then there are none). */
export function loadDefaults(): Partial<GenDefaults> {
  try { return JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

export function SettingsSheet({ open, onClose, params, onParams, words, onWords }: {
  open: boolean; onClose: () => void; params: NaiParams; onParams: (p: NaiParams) => void; words: boolean; onWords: (on: boolean) => void;
}) {
  const [theme, setPref] = useState<ThemePref>({ theme: "night" });
  const [defaults, setDefaults] = useState<GenDefaults>({ sampler: params.sampler, noiseSchedule: params.noiseSchedule, cfgRescale: params.cfgRescale });
  const [danbooru, setDanbooru] = useState<boolean | null>(null);
  const { anlas } = useAnlas(open);

  useEffect(() => {
    if (!open) return;
    setPref(getTheme());
    setDefaults((d) => ({ ...d, ...loadDefaults() }));
    requestJson<{ danbooru: boolean }>("/api/status").then((r) => setDanbooru(r.ok ? r.data.danbooru : null));
  }, [open]);

  const pick = (p: ThemePref) => { setTheme(p); setPref(p); };
  const saveDefaults = (d: GenDefaults) => {
    const fixed = fixSchedule({ ...params, ...d });
    const next = { sampler: fixed.sampler, noiseSchedule: fixed.noiseSchedule, cfgRescale: fixed.cfgRescale };
    setDefaults(next);
    try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next)); } catch {}
  };
  const field = "bg-bg border-border w-full rounded-md border px-2 py-2.5 font-mono text-base";
  const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";

  return (
    <Sheet open={open} onClose={onClose} label="Settings" closeLabel="Close settings"
      className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <section>
          <h3 className={h3}>Theme</h3>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-5 gap-2">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme.theme === t.id} onClick={() => pick({ ...theme, theme: t.id })}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[11px] ${theme.theme === t.id ? "border-accent" : "border-border"}`}>
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-full border border-black/10" style={{ background: t.bg }}>
                  <span className="size-3.5 rounded-full" style={{ background: t.accent }} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex min-h-11 items-center gap-3 text-sm">
            <label className="flex flex-1 items-center gap-3">
              <input type="color" value={theme.accent ?? THEMES.find((t) => t.id === theme.theme)?.accent ?? "#b7a4ff"}
                onChange={(e) => pick({ ...theme, accent: e.target.value })} className="size-10 cursor-pointer rounded-md border-0 bg-transparent" />
              Custom accent
            </label>
            {theme.accent && <button type="button" onClick={() => pick({ theme: theme.theme })} className="text-accent px-2 py-2">Reset</button>}
          </div>
        </section>

        <section>
          <h3 className={h3}>Generation defaults</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-muted text-xs">Sampler
              <select value={defaults.sampler} onChange={(e) => saveDefaults({ ...defaults, sampler: e.target.value })} className={`${field} mt-1`}>
                {SAMPLERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-muted text-xs">Noise schedule
              <select value={defaults.noiseSchedule} onChange={(e) => saveDefaults({ ...defaults, noiseSchedule: e.target.value })} className={`${field} mt-1`}>
                {schedulesFor(defaults.sampler).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-muted col-span-2 text-xs">
              <span className="flex justify-between">Guidance rescale<span className="text-fg font-mono">{defaults.cfgRescale.toFixed(2)}</span></span>
              <input type="range" min={0} max={1} step={0.02} value={defaults.cfgRescale} onChange={(e) => saveDefaults({ ...defaults, cfgRescale: Number(e.target.value) })}
                className="accent-accent mt-2 h-8 w-full" />
            </label>
          </div>
          <button type="button" onClick={() => onParams({ ...params, ...defaults })} className="border-border mt-2 w-full rounded-md border px-3 py-2.5 text-sm">Use these now</button>
          <p className="text-faint mt-1 text-xs">New prompts on this device start with these.</p>
        </section>

        <section>
          <h3 className={h3}>Characters</h3>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Position words<span className="text-muted block text-xs">In Custom placement, add where each box is to its prompt</span></span>
            <input type="checkbox" role="switch" checked={words} onChange={(e) => onWords(e.target.checked)} className="accent-accent size-5" />
          </label>
        </section>

        <section>
          <h3 className={h3}>Account</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Anlas</dt><dd className="font-mono">{anlas === null ? "…" : anlas.toLocaleString()}</dd>
            <dt className="text-muted">Danbooru</dt>
            <dd>{danbooru === null ? "…" : danbooru ? "Account key set" : <>Anonymous (2-tag searches)<span className="text-faint block text-xs">Add DANBOORU_LOGIN and DANBOORU_API_KEY to studio/.env</span></>}</dd>
          </dl>
        </section>
      </div>
    </Sheet>
  );
}
