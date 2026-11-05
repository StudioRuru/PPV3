"use client";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { requestJson } from "@/lib/net";
import { substituteMacros } from "@/lib/rp/prompt";
import type { RpCharacter, RpChat as Chat, RpPersona } from "@/lib/rp/types";
import { Sheet } from "../Sheet";
import { CharacterSheet } from "./CharacterSheet";
import { RpChat } from "./RpChat";

export type GalleryChar = RpCharacter & { chats: number; lastChat: number | null };
export const avatarUrl = (p: string | null | undefined) => (p ? `/api/rp/files/avatars/${p}` : null);
export const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type Face = { id?: number; name: string; avatarPath?: string | null };
/** Shared-element names: the same character's portrait/avatar and name morph between views. */
export const vt = (kind: "av" | "name", c: Face) => (c.id ? { viewTransitionName: `rp-${kind}-${c.id}` } : undefined);

/** Swap RP views inside a View Transition so named elements morph; instant where unsupported or motion is reduced. */
export function morph(update: () => void) {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  document.startViewTransition(() => flushSync(update));
}

export function Avatar({ c, size = "size-10", shared }: { c: Face; size?: string; shared?: boolean }) {
  const url = avatarUrl(c.avatarPath), style = shared ? vt("av", c) : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" style={style} className={`${size} shrink-0 rounded-full object-cover`} />
    : <span aria-hidden="true" style={style} className={`${size} bg-surface-2 text-accent grid shrink-0 place-items-center rounded-full font-semibold`}>{c.name.slice(0, 1).toUpperCase()}</span>;
}

/** 3:4 card portrait (gallery + character hero); always the shared element for its character. */
function Portrait({ c, className = "" }: { c: Face; className?: string }) {
  const url = avatarUrl(c.avatarPath);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" style={vt("av", c)} className={`aspect-[3/4] w-full object-cover ${className}`} />
    : <span aria-hidden="true" style={vt("av", c)} className={`bg-surface-2 text-accent grid aspect-[3/4] w-full place-items-center text-4xl font-semibold ${className}`}>{c.name.slice(0, 1)}</span>;
}

const scrim = { background: "linear-gradient(to top, rgb(0 0 0 / .78), rgb(0 0 0 / .25) 60%, transparent)" };

const ago = (t: number | null) => {
  if (!t) return "no chats yet";
  const d = (Date.now() - t) / 86_400_000;
  return d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.floor(d)} days ago`;
};

type View = { kind: "gallery" } | { kind: "character"; id: number } | { kind: "chat"; id: number; chatId: number };

/** RP tab: character gallery → a character's chats → the chat. Cards are edited in the character sheet. */
export function RpScreen({ active }: { active: boolean }) {
  const [chars, setChars] = useState<GalleryChar[]>([]);
  const [view, setView] = useState<View>({ kind: "gallery" });
  const [chats, setChats] = useState<Chat[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<RpPersona[]>([]);
  const [meOpen, setMeOpen] = useState(false);
  const [me, setMe] = useState<Partial<RpPersona>>({});
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await requestJson<{ characters: GalleryChar[] }>("/api/rp/characters");
    if (r.ok) setChars(r.data.characters);
    const p = await requestJson<{ personas: RpPersona[] }>("/api/rp/personas");
    if (p.ok) setPersonas(p.data.personas);
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const openCharacter = useCallback(async (id: number) => {
    morph(() => setView({ kind: "character", id }));
    const r = await requestJson<{ chats: Chat[] }>(`/api/rp/characters/${id}`);
    if (r.ok) setChats(r.data.chats);
  }, []);

  async function newChat(characterId: number) {
    const r = await requestJson<{ chat: Chat }>("/api/rp/chats", { method: "POST", ...json({ characterId, personaId: personas[0]?.id ?? null }) });
    if (r.ok) morph(() => setView({ kind: "chat", id: characterId, chatId: r.data.chat.id }));
    else setError(r.error);
  }

  /** One card → straight into a new chat with it. Several → all land in the gallery; failures are listed. */
  async function doImport(files?: File[]) {
    setBusy(true); setError(null);
    const one = (f?: File) => {
      if (!f) return requestJson<{ character: RpCharacter }>("/api/rp/import", { method: "POST", ...json({ url: importUrl }) });
      const fd = new FormData(); fd.append("file", f);
      return requestJson<{ character: RpCharacter }>("/api/rp/import", { method: "POST", body: fd });
    };
    const results = files?.length ? await Promise.all(files.map(one)) : [await one()];
    setBusy(false);
    const failed = results.flatMap((r, i) => (r.ok ? [] : [`${files?.[i]?.name ?? "link"}: ${r.error}`]));
    const done = results.flatMap((r) => (r.ok ? [r.data.character] : []));
    if (failed.length) setError(failed.join(" · "));
    if (!done.length) return;
    if (!failed.length) { setImporting(false); setImportUrl(""); }
    await load();
    if (done.length === 1 && !failed.length) newChat(done[0].id);
  }

  async function saveMe() {
    if (!me.name?.trim()) return;
    const r = await requestJson<{ personas: RpPersona[] }>("/api/rp/personas", { method: "POST", ...json(me) });
    if (r.ok) { setPersonas(r.data.personas); setMeOpen(false); }
  }

  async function deleteChat(id: number) {
    await requestJson(`/api/rp/chats/${id}`, { method: "DELETE" });
    setConfirmDel(null);
    if (view.kind === "character") openCharacter(view.id);
  }

  const current = view.kind !== "gallery" ? chars.find((c) => c.id === view.id) : null;

  if (view.kind === "chat" && current) {
    return <RpChat key={view.chatId} character={current} chatId={view.chatId} personas={personas}
      onBack={() => { openCharacter(current.id); load(); }} onEdit={() => setEditing(current.id)}
      sheet={editing !== null && <CharacterSheet id={editing} onClose={() => setEditing(null)} onSaved={() => load()} onDeleted={() => { setEditing(null); morph(() => setView({ kind: "gallery" })); load(); }} />} />;
  }

  return (
    <section aria-label="Roleplay" className="space-y-3">
      {view.kind === "gallery" || !current ? (
        <>
          <header className="flex items-center gap-2">
            <h1 className="flex-1 text-[15px] font-semibold tracking-wide">Roleplay</h1>
            <button type="button" onClick={() => { setMe(personas[0] ?? { name: "" }); setMeOpen(true); }} className="border-border text-muted h-10 rounded-full border px-3 text-xs">
              You: <span className="text-fg font-semibold">{personas[0]?.name ?? "set up"}</span>
            </button>
            <button type="button" onClick={() => { setImporting(true); setError(null); }} className="border-border h-10 rounded-full border px-3 text-sm">Import</button>
            <button type="button" onClick={() => setEditing("new")} className="bg-accent text-accent-fg h-10 rounded-full px-3 text-sm font-semibold">New</button>
          </header>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {!chars.length && <p className="text-muted py-10 text-center text-sm">No characters yet — import a Tavern/Chub card or make one.</p>}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {chars.map((c, i) => (
              <button key={c.id} type="button" onClick={() => openCharacter(c.id)} style={{ animationDelay: `${Math.min(i, 10) * 45}ms` }}
                className="group bg-surface border-border animate-rise relative overflow-hidden rounded-xl border text-left shadow-sm hover:shadow-lg">
                <Portrait c={c} className="transition-[scale] duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]" />
                <span className="absolute inset-x-0 bottom-0 space-y-0.5 p-2.5 pt-10 text-white" style={scrim}>
                  <span style={vt("name", c)} className="block w-fit max-w-full truncate text-sm font-semibold">{c.name}</span>
                  <span className="block font-mono text-[11px] text-white/70">{c.chats} chat{c.chats === 1 ? "" : "s"} · {ago(c.lastChat)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="relative isolate -mx-4 overflow-hidden px-4 pt-1 pb-4">
            {avatarUrl(current.avatarPath) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl(current.avatarPath)!} alt="" aria-hidden="true" className="animate-fade absolute inset-0 -z-10 size-full scale-125 object-cover opacity-35 blur-3xl" />
            )}
            <span aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: "linear-gradient(to bottom, transparent 30%, var(--color-bg))" }} />
            <header className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => morph(() => setView({ kind: "gallery" }))} aria-label="Back to characters" className="border-border bg-bg/60 grid size-10 place-items-center rounded-full border backdrop-blur">‹</button>
              <button type="button" onClick={() => setEditing(current.id)} className="border-border bg-bg/60 h-10 rounded-full border px-3 text-sm backdrop-blur">Edit</button>
            </header>
            <div className="mt-3 flex items-end gap-3">
              <Portrait c={current} className="w-28 shrink-0 rounded-xl shadow-xl ring-1 ring-white/10" />
              <div className="min-w-0 flex-1 pb-1">
                <h1 style={vt("name", current)} className="w-fit max-w-full text-xl leading-tight font-semibold text-balance">{current.name}</h1>
                <p className="text-muted animate-rise mt-1 font-mono text-[11px]" style={{ animationDelay: "120ms" }}>{current.chats} chat{current.chats === 1 ? "" : "s"} · {ago(current.lastChat)}</p>
              </div>
            </div>
            {current.description && <p className="text-muted animate-rise mt-3 line-clamp-3 text-sm" style={{ animationDelay: "160ms" }}>{substituteMacros(current.description, current.name, personas[0]?.name || "User")}</p>}
          </div>
          <button type="button" onClick={() => newChat(current.id)} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold">New chat</button>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          <ul className="space-y-1.5">
            {chats.map((ch, i) => (
              <li key={ch.id} className="bg-surface border-border animate-rise flex items-center rounded-lg border" style={{ animationDelay: `${Math.min(i, 8) * 40 + 120}ms` }}>
                <button type="button" onClick={() => morph(() => setView({ kind: "chat", id: current.id, chatId: ch.id }))} className="min-w-0 flex-1 p-3 text-left">
                  <span className="block truncate text-sm font-semibold">{ch.title}</span>
                  <span className="text-muted font-mono text-[11px]">{ago(ch.updatedAt)}{ch.memorySummary ? " · has memory" : ""}</span>
                </button>
                <button type="button" aria-label={`Delete chat ${ch.title}`} onClick={() => setConfirmDel(ch.id)} className="text-faint grid size-11 place-items-center">×</button>
              </li>
            ))}
          </ul>
          {confirmDel !== null && (
            <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-lg border p-2 text-sm">
              <span className="flex-1">Delete this chat and its messages?</span>
              <button type="button" onClick={() => setConfirmDel(null)} className="px-2 py-1.5">Cancel</button>
              <button type="button" onClick={() => deleteChat(confirmDel)} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Delete</button>
            </div>
          )}
        </>
      )}

      <Sheet open={importing} onClose={() => setImporting(false)} label="Import character" closeLabel="Close import" className="rounded-t-2xl border-t lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center p-3"><h2 className="flex-1 text-base font-semibold">Import a character</h2>
          <button type="button" onClick={() => setImporting(false)} aria-label="Close" className="border-border size-11 rounded-full border">×</button></header>
        <div className="space-y-3 px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <label className="border-border flex h-12 cursor-pointer items-center justify-center rounded-lg border border-dashed text-sm">
            <span className={busy ? "sweep rounded px-2" : ""}>{busy ? "Importing…" : "Choose cards (PNG or JSON)"}</span>
            <input type="file" multiple accept="image/png,application/json,.json" className="sr-only" disabled={busy} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) doImport(f); }} />
          </label>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (importUrl.trim()) doImport(); }}>
            <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="or paste a chub.ai link" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2.5 text-base" />
            <button type="submit" disabled={busy || !importUrl.trim()} className="bg-accent text-accent-fg rounded-md px-3 font-semibold disabled:opacity-50">Get</button>
          </form>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          <p className="text-faint text-xs">One card opens a chat with them right away; pick several to fill the gallery. Embedded lorebooks come along. Nothing is sent anywhere except Chub, when you paste a link.</p>
        </div>
      </Sheet>

      <Sheet open={meOpen} onClose={() => setMeOpen(false)} label="Your persona" closeLabel="Close persona" className="rounded-t-2xl border-t lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center p-3"><h2 className="flex-1 text-base font-semibold">Who you are in roleplay</h2>
          <button type="button" onClick={() => setMeOpen(false)} aria-label="Close" className="border-border size-11 rounded-full border">×</button></header>
        <form className="space-y-2 px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }} onSubmit={(e) => { e.preventDefault(); saveMe(); }}>
          {([["name", "Name"], ["description", "About you"], ["relationship", "Relationship to characters"], ["addressAs", "Characters call you"], ["boundaries", "Boundaries"]] as const).map(([k, label]) => (
            <label key={k} className="block text-xs"><span className="text-muted">{label}</span>
              {k === "description" ? <textarea value={me[k] ?? ""} onChange={(e) => setMe({ ...me, [k]: e.target.value })} rows={3} className="bg-bg border-border mt-1 w-full rounded-md border px-2 py-2 text-base" />
                : <input value={me[k] ?? ""} onChange={(e) => setMe({ ...me, [k]: e.target.value })} className="bg-bg border-border mt-1 w-full rounded-md border px-2 py-2 text-base" />}
            </label>
          ))}
          <button type="submit" disabled={!me.name?.trim()} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold disabled:opacity-50">Save</button>
        </form>
      </Sheet>

      {editing !== null && <CharacterSheet id={editing} onClose={() => setEditing(null)}
        onSaved={(id) => { load(); if (editing === "new") openCharacter(id); else if (view.kind === "character") openCharacter(view.id); }}
        onDeleted={() => { setEditing(null); morph(() => setView({ kind: "gallery" })); load(); }} />}
    </section>
  );
}
