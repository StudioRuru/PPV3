"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { inline, mdBlocks } from "@/lib/md";
import { emitMascot } from "@/lib/mascot/bus";
import { requestJson } from "@/lib/net";
import { spyData, spyDue } from "@/lib/mascot/spy";
import { substituteMacros } from "@/lib/rp/prompt";
import type { RpChat as Chat, RpMessage, RpPersona } from "@/lib/rp/types";
import { AutoTextarea, useAutoSize } from "../TagInput";
import { enabledMods, TuneSheet } from "./TuneSheet";
import { Avatar, json, type GalleryChar } from "./RpScreen";

type View = { chat: Chat; messages: RpMessage[]; version: number };
const LIKE_Q = ["In character", "Great pacing", "Vivid", "Funny"], DISLIKE_Q = ["Out of character", "Too fast", "Too tame", "Wrote for me", "Repetitive"];

function Prose({ text }: { text: string }) {
  // RP convention: *actions* render as italics, "speech" stays plain.
  return <>{mdBlocks(text).map((b, i) => (
    <p key={i} className="whitespace-pre-wrap">{inline(b.text).map((r, j) => (r.b ? <strong key={j}>{r.t}</strong> : r.i ? <em key={j} className="text-muted">{r.t}</em> : r.t))}</p>
  ))}</>;
}

let lastSpyAt = 0; // module-level: survives remounts
let mischief = 5; // mascot setting, kept fresh by the effect below

/** One RP chat: streaming replies on the heavy model, swipes, edit, rewind, regenerate, feedback, memory. */
export function RpChat({ character, chatId, personas, onBack, onEdit, sheet }: {
  character: GalleryChar; chatId: number; personas: RpPersona[]; onBack: () => void; onEdit: () => void; sheet: React.ReactNode;
}) {
  const [v, setV] = useState<View | null>(null);
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<{ text: string; replacing?: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [rewind, setRewind] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; kind: "like" | "dislike"; note: string } | null>(null);
  const [rated, setRated] = useState<Record<number, "like" | "dislike">>({});
  const [memory, setMemory] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const composer = useAutoSize(input);
  const pinned = useRef(true); // follow the stream only while the reader is at the bottom

  const load = useCallback(async () => {
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`);
    if (r.ok) setV(r.data); else setError(r.error);
  }, [chatId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { emitMascot("rp_chat", { character: character.name }); }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opened chat
  useEffect(() => {
    const on = (e: Event) => { const m = (e as CustomEvent<{ mischief?: number }>).detail?.mischief; if (typeof m === "number") mischief = m; };
    requestJson<{ settings: { mischief?: number } }>("/api/mascot/state").then((r) => { if (r.ok && typeof r.data.settings.mischief === "number") mischief = r.data.settings.mischief; });
    window.addEventListener("mascot:settings", on);
    return () => window.removeEventListener("mascot:settings", on);
  }, []);
  useEffect(() => {
    const on = () => { pinned.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120; };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => { if (pinned.current) end.current?.scrollIntoView({ block: "end" }); }, [v?.messages.length, stream?.text]);

  const persona = personas.find((p) => p.id === v?.chat.personaId) ?? personas[0];
  const sub = (t: string) => substituteMacros(t, character.name, persona?.name || "User");
  const busy = !!stream;

  async function patch(body: object) {
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`, { method: "PATCH", ...json({ ...body, version: v?.version }) });
    if (r.ok) { setV(r.data); setError(null); return true; }
    setError(r.error); load(); return false;
  }

  async function send(body: { text?: string; regenerate?: number; retry?: boolean }) {
    if (!v || busy) return;
    pinned.current = true;
    setError(null); setStatus("Thinking…");
    setStream({ text: "", replacing: body.regenerate });
    if (body.text) setV({ ...v, messages: [...v.messages, { id: -1, chatId, role: "user", content: body.text, swipes: [], activeSwipeIndex: 0, createdAt: Date.now(), updatedAt: Date.now() }] });
    try {
      const res = await fetch(`/api/rp/chats/${chatId}/send`, { method: "POST", ...json({ ...body, version: v.version }) });
      if (!res.ok || !res.body) {
        const t = await res.text();
        let msg = t; try { msg = JSON.parse(t).error ?? t; } catch { /* text */ }
        throw new Error(res.status === 401 ? "Session expired — reload and sign in." : msg || `Server error ${res.status}`);
      }
      if (res.headers.get("X-Paused") === "1") setStatus(`Loading ${res.headers.get("X-Model") ?? "the heavy model"} — captioner + TIPO paused…`);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        setStatus(null); setStream({ text, replacing: body.regenerate });
      }
      const warn = /\n\n⚠️ ([^\n]*)$/.exec(text);
      if (warn) setError(warn[1]);
    } catch (e) {
      setError((e as Error).message);
      // Not sent (conflict, offline…): give the typed text back instead of losing it.
      if (body.text) setInput((cur) => cur || body.text!);
    }
    setStream(null); setStatus(null);
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`);
    if (r.ok) {
      setV(r.data);
      if (r.data.messages.at(-1)?.role === "assistant" && spyDue(Date.now(), lastSpyAt, mischief, Math.random)) { lastSpyAt = Date.now(); emitMascot("rp_spy", spyData(r.data.messages)); }
    } else setError(r.error);
  }

  function submit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send({ text });
  }

  function rate(id: number, kind: "like" | "dislike") { if (rated[id]) return; setRated({ ...rated, [id]: kind }); setFeedback({ id, kind, note: "" }); }
  async function sendFeedback(note: string) {
    if (!feedback) return;
    await requestJson("/api/rp/feedback", { method: "POST", ...json({ kind: feedback.kind, note }) });
    emitMascot("rp_feedback", { kind: feedback.kind, note, character: character.name });
    setFeedback(null);
  }

  const msgs = v?.messages ?? [];
  const lastId = msgs.at(-1)?.id;

  return (
    <section aria-label={`Chat with ${character.name}`} className="flex min-h-[calc(100dvh_-_var(--pt)_-_env(safe-area-inset-top))] flex-col gap-2">
      <header className="bg-bg/95 sticky top-0 z-10 -mx-4 flex items-center gap-2 px-4 py-1 backdrop-blur">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="border-border grid size-10 place-items-center rounded-full border">‹</button>
        <Avatar c={character} size="size-9" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">{character.name}</h1>
          {personas.length > 1 && v ? (
            <select value={v.chat.personaId ?? ""} disabled={busy} onChange={(e) => patch({ op: "chat", personaId: Number(e.target.value) || null })} aria-label="You are"
              className="text-muted bg-transparent text-[11px]">{personas.map((p) => <option key={p.id} value={p.id}>as {p.name}</option>)}</select>
          ) : <p className="text-muted truncate text-[11px]">as {persona?.name ?? "User"}</p>}
        </div>
        {v && <button type="button" onClick={() => setTuning(true)} className={`h-10 rounded-full border px-3 text-sm ${enabledMods(v.chat) ? "border-accent text-accent" : "border-border"}`}>
          Tune{enabledMods(v.chat) ? ` · ${enabledMods(v.chat)}` : ""}</button>}
        <button type="button" onClick={onEdit} className="border-border h-10 rounded-full border px-3 text-sm">Card</button>
      </header>

      {v && (
        <details className="bg-surface border-border rounded-lg border text-sm" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setMemory(v.chat.memorySummary); }}>
          <summary className="text-muted cursor-pointer px-3 py-2 text-xs">📌 Memory {v.chat.memorySummary ? "· story so far" : "· builds as the chat grows"}</summary>
          <div className="space-y-2 px-3 pb-3">
            <AutoTextarea value={memory ?? v.chat.memorySummary} onChange={setMemory} />
            <button type="button" disabled={busy || memory === null || memory === v.chat.memorySummary} onClick={() => patch({ op: "chat", memorySummary: memory })}
              className="text-accent text-xs font-semibold disabled:opacity-40">Save memory</button>
          </div>
        </details>
      )}

      <div className="flex-1 space-y-3">
        {msgs.map((m) => {
          const replacing = stream?.replacing === m.id;
          if (editing?.id === m.id) return (
            <div key={m.id} className="space-y-1.5">
              <AutoTextarea value={editing.text} onChange={(text) => setEditing({ id: m.id, text })} />
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={async () => { if (await patch({ op: "edit", msgId: m.id, content: editing.text })) setEditing(null); }} className="bg-accent text-accent-fg rounded-md px-3 py-1.5 font-semibold">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5">Cancel</button>
              </div>
            </div>
          );
          const actions = !busy && m.id > 0 && (
            <div className="text-faint -ml-2 flex flex-wrap items-center text-xs [&>button]:min-h-10 [&>button]:px-2">
              {m.role === "assistant" && m.swipes.length > 1 && (
                <span data-noswipe className="flex items-center gap-1 font-mono">
                  <button type="button" aria-label="Previous version" disabled={m.activeSwipeIndex === 0} onClick={() => patch({ op: "swipe", msgId: m.id, index: m.activeSwipeIndex - 1 })} className="grid size-8 place-items-center disabled:opacity-30">‹</button>
                  {m.activeSwipeIndex + 1}/{m.swipes.length}
                  <button type="button" aria-label="Next version" disabled={m.activeSwipeIndex >= m.swipes.length - 1} onClick={() => patch({ op: "swipe", msgId: m.id, index: m.activeSwipeIndex + 1 })} className="grid size-8 place-items-center disabled:opacity-30">›</button>
                </span>
              )}
              {m.role === "assistant" && <>
                <button type="button" aria-label="Like reply" aria-pressed={rated[m.id] === "like"} disabled={!!rated[m.id]} onClick={() => rate(m.id, "like")} className={rated[m.id] === "like" ? "text-ok" : ""}>👍</button>
                <button type="button" aria-label="Dislike reply" aria-pressed={rated[m.id] === "dislike"} disabled={!!rated[m.id]} onClick={() => rate(m.id, "dislike")} className={rated[m.id] === "dislike" ? "text-danger" : ""}>👎</button>
              </>}
              {m.role === "assistant" && m.id === lastId && <button type="button" onClick={() => send({ regenerate: m.id })}>Regenerate</button>}
              <button type="button" onClick={() => setEditing({ id: m.id, text: m.content })}>Edit</button>
              {m.id !== lastId && <button type="button" onClick={() => setRewind(m.id)}>Rewind here</button>}
            </div>
          );
          return m.role === "user" ? (
            <div key={m.id} className="animate-rise bg-surface-2 ml-10 space-y-1.5 rounded-lg p-2.5 text-sm"><Prose text={sub(m.content)} />{actions}</div>
          ) : (
            <div key={m.id} className="animate-rise flex gap-2">
              <Avatar c={character} size="size-8" />
              <div className="min-w-0 flex-1 space-y-1.5 text-[15px] leading-relaxed">
                <Prose text={sub(replacing ? stream!.text || "…" : m.content)} />
                {actions}
                {feedback?.id === m.id && (
                  <div className="bg-surface border-border animate-rise space-y-2 rounded-lg border p-2.5">
                    <p className="text-xs">{feedback.kind === "like" ? "What worked?" : "What was off?"} <span className="text-faint">(your companion learns how you like stories)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {(feedback.kind === "like" ? LIKE_Q : DISLIKE_Q).map((q) => <button key={q} type="button" onClick={() => sendFeedback(q)} className="border-border h-8 rounded-full border px-3 text-xs">{q}</button>)}
                    </div>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendFeedback(feedback.note); }}>
                      <input value={feedback.note} onChange={(e) => setFeedback({ ...feedback, note: e.target.value })} placeholder="or in your words…" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-1.5 text-base" />
                      <button type="submit" className="text-accent px-2 text-sm font-semibold">Send</button>
                    </form>
                  </div>
                )}
                {rewind === m.id && (
                  <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-lg border p-2 text-sm">
                    <span className="flex-1">Delete every message after this one?</span>
                    <button type="button" onClick={() => setRewind(null)} className="px-2 py-1.5">Cancel</button>
                    <button type="button" onClick={async () => { await patch({ op: "rewind", msgId: m.id }); setRewind(null); }} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Delete</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {rewind !== null && msgs.find((m) => m.id === rewind)?.role === "user" && (
          <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-lg border p-2 text-sm">
            <span className="flex-1">Delete every message after your message?</span>
            <button type="button" onClick={() => setRewind(null)} className="px-2 py-1.5">Cancel</button>
            <button type="button" onClick={async () => { await patch({ op: "rewind", msgId: rewind }); setRewind(null); }} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Delete</button>
          </div>
        )}
        {stream && stream.replacing === undefined && (
          <div className="flex gap-2">
            <Avatar c={character} size="size-8" />
            <div className="min-w-0 flex-1 text-[15px] leading-relaxed">{stream.text ? <Prose text={sub(stream.text)} /> : null}</div>
          </div>
        )}
        {status && (
          <p role="status" className="text-muted flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="thinking flex gap-1">{[0, 1, 2].map((n) => <i key={n} className="bg-accent size-1.5 rounded-full" />)}</span>{status}
          </p>
        )}
        {error && <p role="alert" className="text-danger text-sm">⚠️ {error}</p>}
        {!busy && msgs.at(-1)?.role === "user" && msgs.at(-1)!.id > 0 && (
          <button type="button" onClick={() => send({ retry: true })} className="border-border text-accent h-10 rounded-full border px-4 text-sm font-semibold">Retry reply</button>
        )}
        <div ref={end} />
      </div>

      <form data-composer className="bg-bg/95 border-border sticky z-10 -mx-4 flex gap-2 border-t px-4 py-2 backdrop-blur" style={{ bottom: 0, paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea ref={composer} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={`Message ${character.name}…`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); submit(); } }}
          className="bg-bg border-border max-h-[35dvh] min-w-0 flex-1 resize-none overflow-y-auto rounded-md border px-2 py-2.5 text-base" />
        <button type="submit" disabled={busy || !input.trim()} className="bg-accent text-accent-fg h-11 w-16 self-end rounded-md font-semibold disabled:opacity-50">Send</button>
      </form>
      {v && <TuneSheet open={tuning} onClose={() => setTuning(false)} chat={v.chat} agency={character.agency} sub={sub} onPatch={patch} />}
      {sheet}
    </section>
  );
}
