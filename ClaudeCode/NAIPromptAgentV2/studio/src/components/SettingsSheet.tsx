"use client";
import { useEffect, useRef, useState } from "react";
import { fixSchedule, SAMPLERS, schedulesFor, type NaiParams } from "@/lib/nai-body";
import { requestJson } from "@/lib/net";
import { resolveMods, type ModState } from "@/lib/rp/mods";
import { DEFAULT_RP_SETTINGS, type RpSettings } from "@/lib/rp/types";
import { getTheme, setTheme, THEMES, type ThemePref } from "@/lib/theme";
import { MascotSettings } from "./mascot/MascotSettings";
import { ModList } from "./rp/TuneSheet";
import { Sheet } from "./Sheet";
import { useAnlas } from "./VariationSheet";

type SamplerKey = "temperature" | "topP" | "minP" | "repeatPenalty" | "dryMultiplier";
const RP_SAMPLERS: [SamplerKey, string, number, number, number, string][] = [
  ["temperature", "Temperature", 0.3, 1.6, 0.05, "higher = wilder"], ["topP", "Top P", 0.5, 1, 0.01, "1 = off"],
  ["minP", "Min P", 0, 0.3, 0.01, "trims unlikely words"], ["repeatPenalty", "Repeat penalty", 1, 1.3, 0.01, "1 = off"],
  ["dryMultiplier", "DRY", 0, 2, 0.05, "anti-repeat phrases · Kobold only"],
];
const pickSamplers = (s: RpSettings) => Object.fromEntries(RP_SAMPLERS.map(([k]) => [k, s[k]])) as Pick<RpSettings, SamplerKey>;

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
  const [retention, setRetention] = useState<number | null | undefined>(undefined);
  const [purge, setPurge] = useState<{ days: number | null; count: number } | null>(null);
  const [taste, setTaste] = useState<{ profile: { favoured: string[]; avoided: string[]; notes: string[] }; pinned: { id: number; text: string }[] } | null>(null);
  const [forget, setForget] = useState(false);
  const [models, setModels] = useState<{ heavy: string; quick: string; models: string[]; settings: RpSettings } | null>(null);
  const [mods, setMods] = useState<Record<string, ModState> | null>(null);
  const modsSave = useRef<ReturnType<typeof setTimeout>>(undefined);
  function editMods(next: Record<string, ModState>) { // optimistic; saved ~0.4 s after the last change
    setMods(next);
    clearTimeout(modsSave.current);
    modsSave.current = setTimeout(() => saveModel({ settings: { mods: JSON.stringify(next) } }), 400);
  }
  const post = (body: object) => requestJson<{ autoDeleteDays: number | null; wouldRemove?: number }>("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // Dry run first: if this window would delete images right now, say how many and ask.
  async function chooseRetention(days: number | null) {
    const dry = await post({ autoDeleteDays: days, dryRun: true });
    if (dry.ok && (dry.data.wouldRemove ?? 0) > 0) { setPurge({ days, count: dry.data.wouldRemove! }); return; }
    const r = await post({ autoDeleteDays: days });
    if (r.ok) setRetention(r.data.autoDeleteDays);
  }
  const [samp, setSamp] = useState<Pick<RpSettings, SamplerKey> | null>(null);
  const sampSave = useRef<ReturnType<typeof setTimeout>>(undefined);
  function editSamp(next: Pick<RpSettings, SamplerKey>) {
    setSamp(next);
    clearTimeout(sampSave.current);
    sampSave.current = setTimeout(() => saveModel({ settings: next }), 400);
  }
  async function saveModel(body: { heavy?: string; quick?: string; settings?: Partial<RpSettings> }) {
    const r = await requestJson<NonNullable<typeof models>>("/api/rp/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setModels(r.data);
  }
  const { anlas } = useAnlas(open);
  const [gpu, setGpu] = useState<{ dailyCapUsd: number; keepWarmMaxH: number; idleMin: number } | null>(null);
  const [gpuErr, setGpuErr] = useState<string | null>(null);
  const [gpuSaves, setGpuSaves] = useState(0); // bumps on every save attempt so inputs remount to the stored value
  async function saveGpu(patch: Partial<NonNullable<typeof gpu>>) {
    const r = await requestJson<NonNullable<typeof gpu>>("/api/comfy/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setGpuErr(r.ok ? null : r.error);
    if (r.ok) setGpu(r.data);
    setGpuSaves((n) => n + 1);
  }

  useEffect(() => {
    if (!open) return;
    setPref(getTheme());
    setDefaults((d) => ({ ...d, ...loadDefaults() }));
    requestJson<{ danbooru: boolean }>("/api/status").then((r) => setDanbooru(r.ok ? r.data.danbooru : null));
    requestJson<{ autoDeleteDays: number | null }>("/api/settings").then((r) => r.ok && setRetention(r.data.autoDeleteDays));
    requestJson<NonNullable<typeof taste>>("/api/taste").then((r) => r.ok && setTaste(r.data));
    requestJson<NonNullable<typeof models>>("/api/rp/settings").then((r) => { if (r.ok) { setModels(r.data); setMods(resolveMods(r.data.settings.mods, null)); setSamp(pickSamplers(r.data.settings)); } });
    requestJson<NonNullable<typeof gpu>>("/api/comfy/settings").then((r) => r.ok && setGpu(r.data));
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
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
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
          <h3 className={h3}>Camera roll</h3>
          <div role="radiogroup" aria-label="Auto-delete images after" className="border-border grid grid-cols-4 overflow-hidden rounded-md border">
            {([null, 1, 2, 3] as const).map((d) => (
              <button key={String(d)} type="button" role="radio" aria-checked={retention === d}
                onClick={() => chooseRetention(d)}
                className={`h-10 text-xs font-medium ${retention === d ? "bg-accent text-accent-fg" : "text-muted"}`}>{d === null ? "Never" : `${d} day${d > 1 ? "s" : ""}`}</button>
            ))}
          </div>
          <p className="text-faint mt-1 text-xs">Images older than this are deleted from the Mac automatically. Zip anything you want to keep.</p>
          {purge && (
            <div role="alertdialog" aria-label="Confirm auto-delete" className="border-danger/40 bg-danger/10 mt-2 space-y-2 rounded-lg border p-3 text-sm">
              <p>This deletes <b>{purge.count} image{purge.count === 1 ? "" : "s"}</b> older than {purge.days} day{purge.days === 1 ? "" : "s"} right now, for good.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPurge(null)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
                <button type="button" onClick={async () => { const r = await post({ autoDeleteDays: purge.days }); setPurge(null); if (r.ok) setRetention(r.data.autoDeleteDays); }}
                  className="bg-danger flex-1 rounded-md px-3 py-2 font-semibold text-white">Delete & turn on</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3 className={h3}>Characters</h3>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Position words<span className="text-muted block text-xs">In Custom placement, add where each box is to its prompt</span></span>
            <input type="checkbox" role="switch" checked={words} onChange={(e) => onWords(e.target.checked)} className="accent-accent size-5" />
          </label>
        </section>

        <section>
          <h3 className={h3}>Models</h3>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Heavy model<span className="text-muted block text-xs">Roleplay and the character studio; pauses the captioner + TIPO while it runs</span></span>
            <select value={models?.heavy ?? ""} disabled={!models} aria-label="Heavy model"
              onChange={(e) => saveModel({ heavy: e.target.value })}
              className="bg-bg border-border h-10 max-w-[12rem] rounded-md border px-2 text-sm">
              {models && !models.models.includes(models.heavy) && <option value={models.heavy}>{models.heavy} (not installed)</option>}
              {models?.models.filter((m) => !/embed|bge|nomic/i.test(m)).map((m) => <option key={m} value={m}>{m.replace(/:latest$/, "")}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Quick model<span className="text-muted block text-xs">Miyabi&apos;s quips</span></span>
            <select value={models?.quick ?? ""} disabled={!models} aria-label="Quick model" onChange={(e) => saveModel({ quick: e.target.value })}
              className="bg-bg border-border h-10 max-w-[12rem] rounded-md border px-2 text-sm">
              <option value="">Default (Gemma 4 E4B)</option>
              {models?.quick && !models.models.includes(models.quick) && <option value={models.quick}>{models.quick} (not installed)</option>}
              {models?.models.filter((m) => !/embed|bge|nomic/i.test(m)).map((m) => <option key={m} value={m}>{m.replace(/:latest$/, "")}</option>)}
            </select>
          </label>
        </section>

        <section>
          <h3 className={h3}>Roleplay mods</h3>
          <p className="text-faint mb-2 text-xs">Defaults for every chat until you change that chat&rsquo;s Tune sheet.</p>
          <div className="space-y-2">
            {mods ? <ModList mods={mods} onChange={editMods} sub={(t) => t.replaceAll("{{char}}", "the character").replaceAll("{{user}}", "you")} />
              : <p className="text-faint text-xs">…</p>}
          </div>
        </section>

        <section>
          <h3 className={h3}>Roleplay samplers</h3>
          <p className="text-faint mb-2 text-xs">Every chat, unless a character overrides them. Omega&rsquo;s card suggests temperature 1.0, top P 0.92.</p>
          {samp ? <div data-noswipe className="space-y-1">
            {RP_SAMPLERS.map(([k, label, min, max, step, hint]) => (
              <label key={k} className="block text-sm">
                <span className="flex justify-between"><span>{label}<span className="text-faint ml-2 text-xs">{hint}</span></span><span className="text-accent font-mono text-xs">{samp[k].toFixed(2)}</span></span>
                <input type="range" min={min} max={max} step={step} value={samp[k]} onChange={(e) => editSamp({ ...samp, [k]: Number(e.target.value) })} className="accent-accent h-11 w-full" />
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => editSamp({ ...samp, temperature: 1, topP: 0.92 })} className="border-border h-10 flex-1 rounded-md border text-sm">Omega card</button>
              <button type="button" onClick={() => editSamp(pickSamplers(DEFAULT_RP_SETTINGS))} className="border-border h-10 flex-1 rounded-md border text-sm">Reset</button>
            </div>
          </div> : <p className="text-faint text-xs">…</p>}
        </section>

        <section>
          <h3 className={h3}>GPU</h3>
          <div className="grid grid-cols-3 gap-2">
            {([["dailyCapUsd", "Daily cap ($)", 1, 200], ["keepWarmMaxH", "Keep warm max (h)", 1, 24], ["idleMin", "Idle stop (min)", 10, 240]] as const).map(([k, label, min, max]) => (
              <label key={k} className="text-muted text-xs">{label}
                {/* key remounts the input after every save, so it always shows the stored (clamped) value */}
                <input key={`${gpu?.[k] ?? "…"}-${gpuSaves}`} type="number" inputMode="decimal" min={min} max={max} defaultValue={gpu?.[k] ?? ""} disabled={!gpu}
                  onBlur={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n) && n !== gpu?.[k]) saveGpu({ [k]: n }); else e.target.value = String(gpu?.[k] ?? ""); }}
                  className={`${field} mt-1`} />
              </label>
            ))}
          </div>
          <p className={`mt-1 text-xs ${gpuErr ? "text-danger" : "text-faint"}`}>{gpuErr ?? "The GPU stops itself at the daily cap, after the idle time, or after keep-warm runs out."}</p>
        </section>

        <MascotSettings open={open} />

        <section className="text-sm">
          <h3 className={h3}>Co-pilot taste (learned)</h3>
          {taste?.profile.favoured.length ? <p className="text-xs"><span className="text-ok">likes</span> {taste.profile.favoured.slice(0, 15).join(", ")}</p> : null}
          {taste?.profile.avoided.length ? <p className="text-xs"><span className="text-danger">avoids</span> {taste.profile.avoided.slice(0, 10).join(", ")}</p> : null}
          {taste?.pinned.length ? <p className="text-xs"><span className="text-accent">always</span> {taste.pinned.map((p) => p.text).join(" · ")}</p> : null}
          {!taste?.profile.favoured.length && !taste?.profile.avoided.length && !taste?.profile.notes.length && <p className="text-faint text-xs">Nothing learned yet — like, dislike and apply in Chat.</p>}
          {forget ? (
            <span className="mt-2 flex items-center gap-2 text-xs">Forget likes, dislikes, notes and boldness? (Pinned rules stay.)
              <button type="button" onClick={() => setForget(false)} className="px-2 py-1">Cancel</button>
              <button type="button" onClick={async () => { const r = await requestJson<NonNullable<typeof taste>>("/api/taste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }); if (r.ok) setTaste(r.data); setForget(false); }}
                className="bg-danger rounded px-2 py-1 font-semibold text-white">Forget</button>
            </span>
          ) : <button type="button" onClick={() => setForget(true)} className="text-danger min-h-11 text-xs">Forget what it learned</button>}
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
