"use client";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import type { RpLorebook, RpLoreEntry } from "@/lib/rp/store";
import type { StagedEntry, StagedVoiceLine, StudioCard } from "@/lib/rp/studio-types";
import type { RpCharacter } from "@/lib/rp/types";
import { Sheet } from "../Sheet";
import { AutoTextarea } from "../TagInput";
import { Trash } from "../icons";
import { parseProfile, type RpProfile } from "@/lib/rp/profile";
import { ProfileEditor } from "./ProfileEditor";
import { Avatar, json } from "./RpScreen";

type Line = { id: number; text: string; context: string; embedded: boolean };
type Tab = "card" | "lore" | "voice" | "studio";
type Staged = { card: StudioCard; entries: StagedEntry[]; voiceLines: StagedVoiceLine[] };

const list = (j: string | undefined) => { try { const v = JSON.parse(j || "[]"); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } };
const FIELDS: [keyof RpCharacter, string, number][] = [
  ["description", "Description", 4], ["personality", "Personality", 3], ["scenario", "Scenario", 2], ["firstMessage", "First message", 4],
  ["exampleDialogue", "Example dialogue", 4], ["systemPrompt", "System prompt (overrides the default)", 2], ["postHistoryInstructions", "Post-history instructions", 2],
];
const field = "bg-bg border-border mt-1 w-full rounded-md border px-2 py-2 text-base";

/** Edit a character's card, lorebook and voice lines, or draft one in the character studio (heavy model). */
export function CharacterSheet({ id, onClose, onSaved, onDeleted }: { id: number | "new"; onClose: () => void; onSaved: (id: number) => void; onDeleted: () => void }) {
  const [tab, setTab] = useState<Tab>(id === "new" ? "studio" : "card");
  const [c, setC] = useState<Partial<RpCharacter>>({ name: "" });
  const [dirty, setDirty] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [books, setBooks] = useState<RpLorebook[]>([]);
  const [entries, setEntries] = useState<RpLoreEntry[]>([]);
  const [bookQ, setBookQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [newLine, setNewLine] = useState({ text: "", context: "" });
  // Studio
  const [mode, setMode] = useState<"wiki" | "concept" | "sample">("wiki");
  const [wiki, setWiki] = useState(""); const [query, setQuery] = useState(""); const [hits, setHits] = useState<{ title: string; url: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]); const [concept, setConcept] = useState(""); const [samples, setSamples] = useState("");
  const [progress, setProgress] = useState<string | null>(null); const [staged, setStaged] = useState<Staged | null>(null);

  const cid = c.id ?? (id === "new" ? null : id);
  const load = useCallback(async () => {
    if (id === "new") return;
    const r = await requestJson<{ character: RpCharacter; voiceLines: Line[] }>(`/api/rp/characters/${id}`);
    if (r.ok) { setC(r.data.character); setLines(r.data.voiceLines); setDirty(false); }
  }, [id]);
  const loadLore = useCallback(async (bookId?: number | null) => {
    const r = await requestJson<{ lorebooks: RpLorebook[]; entries?: RpLoreEntry[] }>(`/api/rp/lore${bookId ? `?id=${bookId}` : ""}`);
    if (r.ok) { setBooks(r.data.lorebooks); setEntries(r.data.entries ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "lore") loadLore(c.lorebookId); }, [tab, c.lorebookId, loadLore]);

  const set = (patch: Partial<RpCharacter>) => { setC({ ...c, ...patch }); setDirty(true); };

  async function save(extra: Partial<RpCharacter> = {}): Promise<number | null> {
    const body = { ...c, ...extra };
    if (!body.name?.trim()) { setError("Give the character a name."); return null; }
    const r = await requestJson<{ character: RpCharacter }>("/api/rp/characters", { method: "POST", ...json(body) });
    if (!r.ok) { setError(r.error); return null; }
    setC(r.data.character); setDirty(false); setError(null); setNote("Saved"); onSaved(r.data.character.id);
    return r.data.character.id;
  }

  const profile = parseProfile(c.profile);
  const editProfile = (p: RpProfile) => set({ profile: JSON.stringify({ ...p, edited: true }) });
  async function rebuild(force = false) {
    if (!cid) return;
    if (!force && profile?.edited) { setConfirmRebuild(true); return; }
    setConfirmRebuild(false); setRebuilding(true);
    const r = await requestJson<{ character: RpCharacter }>(`/api/rp/characters/${cid}/profile`, { method: "POST", ...json({ force }) });
    setRebuilding(false);
    if (r.ok) { setC({ ...c, profile: r.data.character.profile, displayName: c.displayName?.trim() ? c.displayName : r.data.character.displayName }); setNote("Profile rebuilt"); setError(null); }
    else if (r.error === "edited") setConfirmRebuild(true);
    else setError(r.error);
  }

  async function del() {
    if (!cid) return;
    await requestJson(`/api/rp/characters/${cid}`, { method: "DELETE" });
    onDeleted();
  }

  // Lorebook
  async function linkBook(bookId: number | null) { set({ lorebookId: bookId }); if (cid) await save({ lorebookId: bookId }); loadLore(bookId); }
  async function newBook() {
    const r = await requestJson<{ id: number }>("/api/rp/lore", { method: "POST", ...json({ lorebook: { name: `${c.name || "New"} lore` } }) });
    if (r.ok) linkBook(r.data.id);
  }
  async function importBook(f?: File) {
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    const r = await requestJson<{ id: number; entries: number }>("/api/rp/lore", { method: "POST", body: fd });
    if (!r.ok) setError(r.error); else { setNote(`Imported ${r.data.entries} entries.`); linkBook(r.data.id); }
  }
  async function deleteBook(b: RpLorebook) {
    if (!confirm(`Delete lorebook "${b.name}" and its ${b.count ?? 0} entries? This can't be undone.`)) return;
    await requestJson(`/api/rp/lore?lorebook=${b.id}`, { method: "DELETE" });
    if (c.lorebookId === b.id) linkBook(null); else loadLore(c.lorebookId);
  }
  async function saveEntry(e: Partial<RpLoreEntry>) {
    const r = await requestJson("/api/rp/lore", { method: "POST", ...json({ entry: { ...e, lorebookId: c.lorebookId } }) });
    if (!r.ok) setError(r.error); else loadLore(c.lorebookId);
  }

  // Voice lines
  async function addLine() {
    if (!cid || !newLine.text.trim()) return;
    const r = await requestJson("/api/rp/voice", { method: "POST", ...json({ characterId: cid, ...newLine }) });
    if (!r.ok) { setError(r.error); return; }
    setNewLine({ text: "", context: "" }); load();
  }
  async function embedAll() {
    setNote("Embedding…");
    const r = await requestJson<{ embedded: number; total: number }>("/api/rp/voice", { method: "POST", ...json({ embed: cid }) });
    setNote(r.ok ? `Embedded ${r.data.embedded} of ${r.data.total}` : null);
    if (!r.ok) setError(r.error); else load();
  }

  // Studio
  async function search() {
    setError(null); setProgress("Searching…");
    const r = await requestJson<{ results: { title: string; url: string }[] }>("/api/rp/studio", { method: "POST", ...json({ action: "search", wiki, query }) });
    setProgress(null);
    if (r.ok) { setHits(r.data.results); setPicked(r.data.results.slice(0, 1).map((h) => h.url)); } else setError(r.error);
  }
  async function research() {
    setError(null); setStaged(null); setProgress("Starting…");
    const res = await fetch("/api/rp/studio", { method: "POST", ...json({ action: "research", name: query || c.name, pageUrls: picked }) });
    if (!res.ok || !res.body) { setProgress(null); setError((await res.json().catch(() => null))?.error ?? `Error ${res.status}`); return; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n"); buf = parts.pop()!;
      for (const p of parts) {
        if (!p.trim()) continue;
        const ev = JSON.parse(p);
        if (ev.type === "progress") setProgress(ev.message ?? ev.phase);
        else if (ev.type === "done") setStaged({ card: ev.card, entries: ev.entries, voiceLines: ev.voiceLines });
        else if (ev.type === "error") setError(ev.message);
      }
    }
    setProgress(null);
  }
  async function draft(action: "draft" | "analyze") {
    setError(null); setStaged(null); setProgress(action === "draft" ? "Writing the card…" : "Reading the sample…");
    const r = await requestJson<{ card: StudioCard }>("/api/rp/studio", { method: "POST", ...json(action === "draft" ? { action, concept } : { action, samples, name: c.name }) });
    setProgress(null);
    if (r.ok) setStaged({ card: r.data.card, entries: [], voiceLines: r.data.card.voiceLines ?? [] }); else setError(r.error);
  }
  /** Saves the staged card over this character (or as a new one), plus its canon lorebook and voice lines. */
  async function useStaged() {
    if (!staged) return;
    const k = staged.card;
    let lorebookId = c.lorebookId ?? null;
    if (staged.entries.length) {
      const r = await requestJson<{ id: number }>("/api/rp/lore", { method: "POST", ...json({ lorebook: { name: `${k.name || c.name} canon` } }) });
      if (r.ok) {
        lorebookId = r.data.id;
        for (const e of staged.entries) await requestJson("/api/rp/lore", { method: "POST", ...json({ entry: { lorebookId, keys: e.keys, content: e.content, constant: e.constant, position: e.position } }) });
      }
    }
    const newId = await save({
      name: k.name || c.name, description: k.description, personality: k.personality, scenario: k.scenario, firstMessage: k.firstMessage,
      exampleDialogue: k.exampleDialogue, alternateGreetings: JSON.stringify(k.alternateGreetings ?? []), tags: JSON.stringify(k.tags ?? []),
      povMode: k.povMode, tense: k.tense, dialogueStyle: k.dialogueStyle, lorebookId,
    });
    if (!newId) return;
    for (const l of staged.voiceLines) await requestJson("/api/rp/voice", { method: "POST", ...json({ characterId: newId, text: l.text, context: l.context }) });
    setStaged(null); setTab("card"); load();
  }

  const close = () => (dirty ? setConfirmClose(true) : onClose());

  return (
    <Sheet open onClose={close} label="Character" closeLabel="Close character" className="h-[92dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-xl lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <Avatar c={{ name: c.name || "?", avatarPath: c.avatarPath }} size="size-9" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{c.name || "New character"}</h2>
        {dirty && <button type="button" onClick={() => save()} className="bg-accent text-accent-fg h-10 rounded-full px-4 text-sm font-semibold">Save</button>}
        <button type="button" onClick={close} aria-label="Close" className="border-border size-11 rounded-full border">×</button>
      </header>
      {confirmClose && (
        <div role="alertdialog" className="border-warn/40 bg-warn/10 mx-3 mb-2 flex items-center gap-2 rounded-lg border p-2 text-sm">
          <span className="flex-1">Discard unsaved changes?</span>
          <button type="button" onClick={() => setConfirmClose(false)} className="px-2 py-1.5">Keep editing</button>
          <button type="button" onClick={onClose} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Discard</button>
        </div>
      )}
      <div data-noswipe role="tablist" className="flex gap-1.5 px-3 pb-2">
        {([["card", "Card"], ["lore", "Lorebook"], ["voice", "Voice"], ["studio", "Studio"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} disabled={!cid && (t === "lore" || t === "voice")} onClick={() => setTab(t)}
            className={`h-9 flex-1 rounded-full text-sm disabled:opacity-40 ${tab === t ? "bg-fg text-bg font-semibold" : "border-border text-muted border"}`}>{label}</button>
        ))}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        {note && <p role="status" className="text-ok text-xs">{note}</p>}

        {tab === "card" && <>
          <label className="block text-xs"><span className="text-muted">Display name (what they're called in chat)</span><input value={c.displayName ?? ""} placeholder={c.name || ""} onChange={(e) => set({ displayName: e.target.value })} className={field} /></label>
          <label className="block text-xs"><span className="text-muted">Card title</span><input value={c.name ?? ""} onChange={(e) => set({ name: e.target.value })} className={field} /></label>
          {FIELDS.map(([k, label]) => (
            <label key={k} className="block text-xs"><span className="text-muted">{label}</span>
              <AutoTextarea value={String(c[k] ?? "")} onChange={(v) => set({ [k]: v })} /></label>
          ))}
          <label className="block text-xs"><span className="text-muted">Alternate greetings (one per paragraph)</span>
            <AutoTextarea value={list(c.alternateGreetings).join("\n\n")} onChange={(v) => set({ alternateGreetings: JSON.stringify(v.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) })} /></label>
          <label className="block text-xs"><span className="text-muted">Tags (comma separated)</span>
            <input value={list(c.tags).join(", ")} onChange={(e) => set({ tags: JSON.stringify(e.target.value.split(",").map((s) => s.trim()).filter(Boolean)) })} className={field} /></label>
          {cid && <details className="border-border rounded-lg border p-2">
            <summary className="cursor-pointer text-sm font-semibold">Profile{profile?.edited ? " · edited" : ""}</summary>
            <div className="pt-3">
              <ProfileEditor value={profile} onChange={editProfile} onRebuild={() => rebuild()} busy={rebuilding} />
              {confirmRebuild && (
                <div role="alertdialog" className="border-warn/40 bg-warn/10 mt-2 flex items-center gap-2 rounded-lg border p-2 text-sm">
                  <span className="flex-1">Overwrite your edits?</span>
                  <button type="button" onClick={() => setConfirmRebuild(false)} className="px-2 py-1.5">Keep</button>
                  <button type="button" onClick={() => rebuild(true)} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Overwrite</button>
                </div>
              )}
            </div>
          </details>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => save()} disabled={!dirty} className="bg-accent text-accent-fg h-11 flex-1 rounded-lg font-semibold disabled:opacity-40">Save card</button>
            {cid && <a href={`/api/rp/characters/${cid}?export=1`} className="border-border grid h-11 place-items-center rounded-lg border px-4 text-sm">Export</a>}
          </div>
          {cid && (confirmDel ? (
            <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-lg border p-2 text-sm">
              <span className="flex-1">Delete {c.name}, all chats and voice lines?</span>
              <button type="button" onClick={() => setConfirmDel(false)} className="px-2 py-1.5">Cancel</button>
              <button type="button" onClick={del} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Delete</button>
            </div>
          ) : <button type="button" onClick={() => setConfirmDel(true)} className="text-danger text-sm">Delete character</button>)}
        </>}

        {tab === "lore" && <>
          <div className="flex gap-2">
            <select value={c.lorebookId ?? ""} onChange={(e) => linkBook(Number(e.target.value) || null)} aria-label="Lorebook" className="bg-bg border-border h-11 min-w-0 flex-1 rounded-md border px-2 text-base">
              <option value="">No lorebook</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count ?? 0})</option>)}
            </select>
            <button type="button" onClick={newBook} className="border-border h-11 rounded-md border px-3 text-sm">New</button>
            <label className="border-border flex h-11 cursor-pointer items-center rounded-md border px-3 text-sm">Import
              <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { importBook(e.target.files?.[0]); e.target.value = ""; }} /></label>
          </div>
          <p className="text-faint text-xs">Entries join the prompt when a key shows up in the recent chat, or when the chat is about the same thing (constant ones always). Import takes SillyTavern World Info or a character card&rsquo;s book.</p>
          {books.length > 0 && <details className="border-border rounded-lg border p-2 text-sm">
            <summary className="cursor-pointer font-semibold">Library ({books.length})</summary>
            <input value={bookQ} onChange={(e) => setBookQ(e.target.value)} placeholder="Search lorebooks" aria-label="Search lorebooks" className={field} />
            {books.filter((b) => b.name.toLowerCase().includes(bookQ.trim().toLowerCase())).map((b) => (
              <div key={b.id} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate">{b.name} <span className="text-faint text-xs">· {b.count ?? 0}</span></span>
                {c.lorebookId === b.id ? <span className="text-accent text-xs">In use</span>
                  : <button type="button" onClick={() => linkBook(b.id)} className="text-accent min-h-11 px-2 text-xs font-semibold">Use</button>}
                <button type="button" onClick={() => deleteBook(b)} aria-label={`Delete ${b.name}`} className="min-h-11 px-2"><Trash /></button>
              </div>
            ))}
          </details>}
          {c.lorebookId && entries.map((e) => <LoreRow key={e.id} e={e} onSave={saveEntry} onDelete={async () => { await requestJson(`/api/rp/lore?entry=${e.id}`, { method: "DELETE" }); loadLore(c.lorebookId); }} />)}
          {c.lorebookId && <button type="button" onClick={() => saveEntry({ keys: [], content: "New entry", enabled: true })} className="text-accent text-sm font-semibold">+ Add entry</button>}
        </>}

        {tab === "voice" && <>
          <p className="text-faint text-xs">Lines {c.name || "they"} would say. Each turn the closest few show the model their voice.</p>
          {lines.map((l) => (
            <div key={l.id} className="bg-surface border-border flex items-start gap-2 rounded-lg border p-2 text-sm">
              <span className="flex-1">{l.context && <span className="text-muted">({l.context}) </span>}&ldquo;{l.text}&rdquo;</span>
              <span className={`font-mono text-[10px] ${l.embedded ? "text-ok" : "text-warn"}`}>{l.embedded ? "✓" : "no vector"}</span>
              <button type="button" aria-label="Delete line" onClick={async () => { await requestJson(`/api/rp/voice?id=${l.id}`, { method: "DELETE" }); load(); }} className="text-faint"><Trash /></button>
            </div>
          ))}
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addLine(); }}>
            <input value={newLine.text} onChange={(e) => setNewLine({ ...newLine, text: e.target.value })} placeholder="A line they'd say" className={field} />
            <div className="flex gap-2">
              <input value={newLine.context} onChange={(e) => setNewLine({ ...newLine, context: e.target.value })} placeholder="situation (optional)" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
              <button type="submit" disabled={!newLine.text.trim()} className="bg-accent text-accent-fg rounded-md px-3 font-semibold disabled:opacity-50">Add</button>
            </div>
          </form>
          {lines.some((l) => !l.embedded) && <button type="button" onClick={embedAll} className="text-accent text-sm font-semibold">Embed missing vectors</button>}
        </>}

        {tab === "studio" && <>
          <div data-noswipe className="flex gap-1.5">
            {([["wiki", "From a wiki"], ["concept", "From an idea"], ["sample", "From a sample chat"]] as const).map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`h-8 flex-1 rounded-full text-xs ${mode === m ? "bg-accent text-accent-fg" : "border-border border"}`}>{label}</button>
            ))}
          </div>
          {mode === "wiki" && <>
            <input value={wiki} onChange={(e) => setWiki(e.target.value)} placeholder="Wiki (e.g. umamusume or naruto.fandom.com)" className={field} />
            <div className="flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Character name" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
              <button type="button" disabled={!wiki.trim() || !query.trim() || !!progress} onClick={search} className="border-border rounded-md border px-3 text-sm disabled:opacity-50">Search</button>
            </div>
            {hits.map((h) => (
              <label key={h.url} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(h.url)} onChange={() => setPicked(picked.includes(h.url) ? picked.filter((u) => u !== h.url) : [...picked, h.url].slice(0, 5))} className="accent-accent size-4" />{h.title}
              </label>
            ))}
            {hits.length > 0 && <button type="button" disabled={!picked.length || !!progress} onClick={research} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold disabled:opacity-50">Research {picked.length} page{picked.length === 1 ? "" : "s"}</button>}
          </>}
          {mode === "concept" && <>
            <AutoTextarea value={concept} onChange={setConcept} />
            <p className="text-faint text-xs">Describe who they are — a few sentences is plenty.</p>
            <button type="button" disabled={!concept.trim() || !!progress} onClick={() => draft("draft")} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold disabled:opacity-50">Draft card</button>
          </>}
          {mode === "sample" && <>
            <AutoTextarea value={samples} onChange={setSamples} />
            <p className="text-faint text-xs">Paste a conversation in their voice; it captures how they talk.</p>
            <button type="button" disabled={samples.trim().length < 20 || !!progress} onClick={() => draft("analyze")} className="bg-accent text-accent-fg h-11 w-full rounded-lg font-semibold disabled:opacity-50">Analyze</button>
          </>}
          {progress && <p role="status" className="text-muted flex items-center gap-2 text-sm"><span aria-hidden="true" className="thinking flex gap-1">{[0, 1, 2].map((n) => <i key={n} className="bg-accent size-1.5 rounded-full" />)}</span>{progress}</p>}
          {staged && (
            <div className="bg-surface border-accent/40 animate-rise space-y-2 rounded-lg border p-3 text-sm">
              <p className="font-semibold">{staged.card.name || c.name}</p>
              <p className="text-muted line-clamp-4">{staged.card.description}</p>
              <p className="text-muted line-clamp-3"><span className="text-fg">Personality:</span> {staged.card.personality}</p>
              <p className="text-faint font-mono text-[11px]">{staged.entries.length} lore entries · {staged.voiceLines.length} voice lines</p>
              <div className="flex gap-2">
                <button type="button" onClick={useStaged} className="bg-accent text-accent-fg h-10 flex-1 rounded-md font-semibold">{cid ? "Replace card with this" : "Create character"}</button>
                <button type="button" onClick={() => setStaged(null)} className="border-border h-10 rounded-md border px-3">Discard</button>
              </div>
            </div>
          )}
          <p className="text-faint text-xs">Runs on the heavy model; the captioner and TIPO pause while it works.</p>
        </>}
      </div>
    </Sheet>
  );
}

function LoreRow({ e, onSave, onDelete }: { e: RpLoreEntry; onSave: (e: Partial<RpLoreEntry>) => void; onDelete: () => void }) {
  const [keys, setKeys] = useState(e.keys.join(", "));
  const [content, setContent] = useState(e.content);
  const changed = keys !== e.keys.join(", ") || content !== e.content;
  return (
    <div className={`bg-surface border-border space-y-1.5 rounded-lg border p-2 ${e.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input value={keys} onChange={(ev) => setKeys(ev.target.value)} placeholder="keys, comma separated" aria-label="Keys" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-1.5 font-mono text-sm" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={e.constant} onChange={() => onSave({ id: e.id, constant: !e.constant })} className="accent-accent" />always</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={e.enabled} onChange={() => onSave({ id: e.id, enabled: !e.enabled })} className="accent-accent" />on</label>
        <button type="button" aria-label="Delete entry" onClick={onDelete} className="text-faint"><Trash /></button>
      </div>
      <AutoTextarea value={content} onChange={setContent} />
      {changed && <button type="button" onClick={() => onSave({ id: e.id, keys: keys.split(",").map((k) => k.trim()).filter(Boolean), content })} className="text-accent text-xs font-semibold">Save entry</button>}
    </div>
  );
}
