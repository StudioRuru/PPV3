"use client";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { substituteMacros } from "@/lib/rp/prompt";
import type { RpCharacter, RpChat as Chat, RpPersona } from "@/lib/rp/types";
import { Sheet } from "../Sheet";
import { CharacterSheet } from "./CharacterSheet";
import { RpChat } from "./RpChat";

export type GalleryChar = RpCharacter & { chats: number; lastChat: number | null };
export const avatarUrl = (p: string | null | undefined) => (p ? `/api/rp/files/avatars/${p}` : null);
export const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function Avatar({ c, size = "size-10" }: { c: { name: string; avatarPath?: string | null }; size?: string }) {
  const url = avatarUrl(c.avatarPath);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span aria-hidden="true" className={`${size} bg-surface-2 text-accent grid shrink-0 place-items-center rounded-full font-semibold`}>{c.name.slice(0, 1).toUpperCase()}</span>;
}

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
    setView({ kind: "character", id });
    const r = await requestJson<{ chats: Chat[] }>(`/api/rp/characters/${id}`);
    if (r.ok) setChats(r.data.chats);
  }, []);

  async function newChat(characterId: number) {
    const r = await requestJson<{ chat: Chat }>("/api/rp/chats", { method: "POST", ...json({ characterId, personaId: personas[0]?.id ?? null }) });
    if (r.ok) setView({ kind: "chat", id: characterId, chatId: r.data.chat.id });
    else setError(r.error);
  }

  async function doImport(file?: File) {
    setBusy(true); setError(null);
    let r;
    if (file) { const fd = new FormData(); fd.append("file", file); r = await requestJson<{ character: RpCharacter }>("/api/rp/import", { method: "POST", body: fd }); }
    else r = await requestJson<{ character: RpCharacter }>("/api/rp/import", { method: "POST", ...json({ url: importUrl }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setImporting(false); setImportUrl("");
    await load();
    openCharacter(r.data.character.id);
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
      sheet={editing !== null && <CharacterSheet id={editing} onClose={() => setEditing(null)} onSaved={() => load()} onDeleted={() => { setEditing(null); setView({ kind: "gallery" }); load(); }} />} />;
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
            {chars.map((c) => (
              <button key={c.id} type="button" onClick={() => openCharacter(c.id)}
                className="bg-surface border-border animate-rise flex flex-col overflow-hidden rounded-xl border text-left">
                {avatarUrl(c.avatarPath)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={avatarUrl(c.avatarPath)!} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  : <span aria-hidden="true" className="bg-surface-2 text-accent grid aspect-[3/4] w-full place-items-center text-4xl font-semibold">{c.name.slice(0, 1)}</span>}
                <span className="space-y-0.5 p-2">
                  <span className="block truncate text-sm font-semibold">{c.name}</span>
                  <span className="text-muted block font-mono text-[11px]">{c.chats} chat{c.chats === 1 ? "" : "s"} · {ago(c.lastChat)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <header className="flex items-center gap-2">
            <button type="button" onClick={() => setView({ kind: "gallery" })} aria-label="Back to characters" className="border-border grid size-10 place-items-center rounded-full border">‹</button>
            <Avatar c={current} />
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{current.name}</h1>
            <button type="button" onClick={() => setEditing(current.id)} className="border-border h-10 rounded-full border px-3 text-sm">Edit</button>
          </header>
          {current.description && <p className="text-muted line-clamp-3 text-sm">{substituteMacros(current.description, current.name, personas[0]?.name || "User")}</p>}
          <button type="button" onClick={() => newChat(current.id)} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold">New chat</button>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          <ul className="space-y-1.5">
            {chats.map((ch) => (
              <li key={ch.id} className="bg-surface border-border flex items-center rounded-lg border">
                <button type="button" onClick={() => setView({ kind: "chat", id: current.id, chatId: ch.id })} className="min-w-0 flex-1 p-3 text-left">
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
            {busy ? "Importing…" : "Choose a card (PNG or JSON)"}
            <input type="file" accept="image/png,application/json,.json" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) doImport(f); }} />
          </label>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (importUrl.trim()) doImport(); }}>
            <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="or paste a chub.ai link" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2.5 text-base" />
            <button type="submit" disabled={busy || !importUrl.trim()} className="bg-accent text-accent-fg rounded-md px-3 font-semibold disabled:opacity-50">Get</button>
          </form>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          <p className="text-faint text-xs">Embedded lorebooks come along. Nothing is sent anywhere except Chub, when you paste a link.</p>
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
        onDeleted={() => { setEditing(null); setView({ kind: "gallery" }); load(); }} />}
    </section>
  );
}
