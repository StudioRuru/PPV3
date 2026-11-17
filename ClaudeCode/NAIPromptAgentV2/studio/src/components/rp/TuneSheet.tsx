"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/net";
import type { RpLorebook } from "@/lib/rp/store";
import { MODS, resolveMods, type ModState } from "@/lib/rp/mods";
import { REPLY_AGENCY_STOPS, REPLY_LENGTH_STOPS, REPLY_SPICE_STOPS } from "@/lib/rp/presets";
import { DEFAULT_RP_SETTINGS, type RpChat } from "@/lib/rp/types";
import { Sheet } from "../Sheet";
import { AutoTextarea } from "../TagInput";

type Draft = { think: boolean; doubleText: boolean; replyLength: number; replySpice: number; replyAgency: number; authorNote: string; mods: Record<string, ModState> };
const MOOD: [keyof Draft & `reply${string}`, string, string[]][] = [
  ["replyLength", "Reply length", REPLY_LENGTH_STOPS], ["replySpice", "Spice", REPLY_SPICE_STOPS], ["replyAgency", "Will", REPLY_AGENCY_STOPS],
];

/** Global defaults (Settings → Roleplay mods) apply until a chat is tuned; tuning saves the chat's full map. */
export const enabledMods = (chat: RpChat, globalMods?: string) => Object.values(resolveMods(globalMods, chat.mods)).filter((m) => m.enabled).length;

/** Toggle + strength card per mod — shared by Tune (per chat) and Settings (global defaults). */
export function ModList({ mods, onChange, sub }: { mods: Record<string, ModState>; onChange: (mods: Record<string, ModState>) => void; sub: (t: string) => string }) {
  const setMod = (id: string, patch: Partial<ModState>) => onChange({ ...mods, [id]: { ...mods[id], ...patch } });
  return MODS.map((m) => {
    const s = mods[m.id];
    return (
      <div key={m.id} className={`border-border space-y-1 rounded-lg border p-3 transition-[border-color,background-color] duration-200 ${s.enabled ? "border-accent/50 bg-accent/5" : "bg-bg"}`}>
        <label className="flex min-h-11 items-center gap-3">
          <span className="flex-1 text-sm font-semibold">{m.label}</span>
          <input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => setMod(m.id, { enabled: e.target.checked })} className="switch" />
        </label>
        <p className="text-faint text-xs">{sub(m.blurb)}</p>
        <div className="fold" data-collapsed={!s.enabled || undefined} inert={!s.enabled}><div>
          <div data-noswipe className="pt-1">
            <input type="range" min={m.min} max={m.max} step={m.step} value={s.value} aria-label={`${m.label} strength`}
              onChange={(e) => setMod(m.id, { value: Number(e.target.value) })} className="accent-accent h-11 w-full" />
            <div className="text-muted flex justify-between font-mono text-[11px]">
              <span>{m.leftLabel ?? ""}</span><span className="text-accent">{m.format?.(s.value) ?? s.value}</span><span>{m.rightLabel ?? ""}</span>
            </div>
          </div>
        </div></div>
      </div>
    );
  });
}

const fromChat = (c: RpChat, agency: number | null, globalMods?: string, thinking?: boolean): Draft => ({
  think: thinking ?? c.think === 1, doubleText: c.doubleText !== 0,
  replyLength: c.replyLength ?? DEFAULT_RP_SETTINGS.replyLength, replySpice: c.replySpice ?? DEFAULT_RP_SETTINGS.replySpice,
  replyAgency: c.replyAgency ?? agency ?? DEFAULT_RP_SETTINGS.replyAgency, authorNote: c.authorNote, mods: resolveMods(globalMods, c.mods),
});

/** Per-chat steering: reply mood sliders, Mods (hypnosis, bimbofication…), author's note. Saves itself ~0.4 s after a change. */
export function TuneSheet({ open, onClose, chat, globalMods, thinking, agency, sub, onPatch }: {
  open: boolean; onClose: () => void; chat: RpChat; globalMods?: string; thinking?: boolean; agency: number | null; sub: (t: string) => string; onPatch: (body: object) => Promise<boolean>;
}) {
  const [d, setD] = useState(() => fromChat(chat, agency, globalMods, thinking));
  const touched = useRef(false), thinkTouched = useRef(false);
  const [books, setBooks] = useState<RpLorebook[]>([]);
  const [bookId, setBookId] = useState(chat.lorebookId);
  useEffect(() => { if (open) { setBookId(chat.lorebookId); requestJson<{ lorebooks: RpLorebook[] }>("/api/rp/lore").then((r) => r.ok && setBooks(r.data.lorebooks)); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on open only
  useEffect(() => { if (open) { setD(fromChat(chat, agency, globalMods, thinking)); touched.current = false; thinkTouched.current = false; } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on open only

  useEffect(() => {
    if (!touched.current) return;
    // Think is only saved once its switch is flipped (1 on, 0 off); otherwise the chat keeps following the mode/model default.
    const { think, ...rest } = d;
    const t = setTimeout(() => { onPatch({ op: "chat", ...rest, ...(thinkTouched.current && { think: think ? 1 : 0 }), doubleText: d.doubleText ? 1 : 0, mods: JSON.stringify(d.mods) }); }, 400);
    return () => clearTimeout(t);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps -- debounce on edits only

  const edit = (patch: Partial<Draft>) => { touched.current = true; setD((x) => ({ ...x, ...patch })); };

  return (
    <Sheet open={open} onClose={onClose} label="Tune this chat" closeLabel="Close tuning" className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center p-3"><h2 className="flex-1 text-base font-semibold">Tune this chat</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 rounded-full border">×</button></header>
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <div data-noswipe className="space-y-3">
          {MOOD.map(([k, label, stops]) => (
            <label key={k} className="block text-sm">
              <span className="flex justify-between"><span>{label}</span><span className="text-accent font-mono text-xs">{stops[d[k]]}</span></span>
              <input type="range" min={0} max={4} step={1} value={d[k]} onChange={(e) => edit({ [k]: Number(e.target.value) })} className="accent-accent h-11 w-full" />
            </label>
          ))}
        </div>

        <label className="flex items-center gap-3 text-sm">
          <span className="flex-1">Think before replying<span className="text-faint block text-xs">A short private plan in character first — slower; read it under 💭 Thought.</span></span>
          <input type="checkbox" role="switch" checked={d.think} onChange={(e) => { thinkTouched.current = true; edit({ think: e.target.checked }); }} className="switch" />
        </label>
        {chat.style === "text" && <label className="flex items-center gap-3 text-sm">
          <span className="flex-1">Double-texts<span className="text-faint block text-xs">If you go quiet for a few minutes, {sub("{{char}}")} may text again.</span></span>
          <input type="checkbox" role="switch" checked={d.doubleText} onChange={(e) => edit({ doubleText: e.target.checked })} className="switch" />
        </label>}

        <label className="block text-sm"><span>Chat lorebook</span>
          <span className="text-faint block text-xs">Added on top of the character&rsquo;s own lorebook, for this chat only.</span>
          <select value={bookId ?? ""} onChange={(e) => { const v = Number(e.target.value) || null; setBookId(v); onPatch({ op: "chat", lorebookId: v }); }}
            className="bg-bg border-border mt-1 h-11 w-full rounded-md border px-2 text-base">
            <option value="">None</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count ?? 0})</option>)}
          </select>
        </label>

        <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">Mods</h3>
        <ModList mods={d.mods} onChange={(mods) => edit({ mods })} sub={sub} />

        <label className="block text-sm"><span>Author&rsquo;s note</span>
          <span className="text-faint block text-xs">Slipped in a few messages back every turn — steer the scene without saying it in chat.</span>
          <AutoTextarea value={d.authorNote} onChange={(authorNote) => edit({ authorNote })} placeholder="e.g. It starts raining; {{char}} is getting tired." className="mt-1" />
        </label>
      </div>
    </Sheet>
  );
}
