"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { inline, mdBlocks } from "@/lib/md";
import { emitMascot } from "@/lib/mascot/bus";
import { requestJson } from "@/lib/net";
import { spyData, spyDue } from "@/lib/mascot/spy";
import { substituteMacros } from "@/lib/rp/prompt";
import { MODES, modeOf } from "@/lib/rp/presets";
import { charName } from "@/lib/rp/profile";
import { typingMs } from "@/lib/rp/burst";
import { atBottom } from "@/lib/rp/chat-ui";
import type { RpChat as Chat, RpMessage, RpPersona } from "@/lib/rp/types";
import { AutoTextarea, useAutoSize } from "../TagInput";
import { enabledMods, TuneSheet } from "./TuneSheet";
import { Avatar, json, vt, type GalleryChar } from "./RpScreen";

type View = { chat: Chat; messages: RpMessage[]; version: number; globalMods?: string; thinking?: boolean };
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
  const [thoughtOf, setThoughtOf] = useState<number | null>(null);
  const [rewind, setRewind] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; kind: "like" | "dislike"; note: string } | null>(null);
  const [rated, setRated] = useState<Record<number, "like" | "dislike">>({});
  const [tuning, setTuning] = useState(false);
  const [away, setAway] = useState(false); // scrolled up off the bottom → "↓ Latest" pill
  const [compact, setCompact] = useState(false); // stage portrait scrolled away → compact header
  // Text mode: a new burst's bubbles appear one at a time, each after a typing pause.
  const [reveal, setReveal] = useState<{ id: string; shown: number } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composer = useAutoSize(input);
  const pinned = useRef(true); // follow the stream only while the reader is at the bottom
  const root = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null), form = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`);
    if (r.ok) setV(r.data); else setError(r.error);
  }, [chatId]);
  useEffect(() => { load(); }, [load]);
  // Text mode photos render after the reply: re-fetch every 3 s while any is pending, for up to 90 s.
  const pending = v?.messages.some((m) => m.imageId === -1);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 3000), stop = setTimeout(() => clearInterval(t), 90_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [pending, load]);
  useEffect(() => { emitMascot("rp_chat", { character: character.name }); }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opened chat
  useEffect(() => {
    const on = (e: Event) => { const m = (e as CustomEvent<{ mischief?: number }>).detail?.mischief; if (typeof m === "number") mischief = m; };
    requestJson<{ settings: { mischief?: number } }>("/api/mascot/state").then((r) => { if (r.ok && typeof r.data.settings.mischief === "number") mischief = r.data.settings.mischief; });
    window.addEventListener("mascot:settings", on);
    return () => window.removeEventListener("mascot:settings", on);
  }, []);
  useEffect(() => {
    const on = () => {
      const p = atBottom(window.innerHeight, window.scrollY, document.documentElement.scrollHeight);
      if (p !== pinned.current) { pinned.current = p; setAway(!p); }
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // ponytail: IntersectionObserver, not a scroll-driven animation; switch once WKWebView ships animation-timeline.
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    if (stage.current) io.observe(stage.current);
    return () => io.disconnect();
  }, []);
  // The floating composer's height pads the page bottom and lifts the "↓ Latest" pill.
  useEffect(() => {
    const f = form.current;
    if (!f) return;
    const ro = new ResizeObserver(() => root.current?.style.setProperty("--composer-h", `${f.offsetHeight}px`));
    ro.observe(f);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (pinned.current) end.current?.scrollIntoView({ block: "end" }); }, [v?.messages.length, stream?.text]);

  const persona = personas.find((p) => p.id === v?.chat.personaId) ?? personas[0];
  const name = charName(character);
  const sub = (t: string) => substituteMacros(t, name, persona?.name || "User");
  const busy = !!stream || !!reveal;
  useEffect(() => {
    if (!reveal) return;
    const rows = (v?.messages ?? []).filter((m) => m.burstId === reveal.id);
    if (reveal.shown >= rows.length) { setReveal(null); return; }
    const t = setTimeout(() => setReveal({ ...reveal, shown: reveal.shown + 1 }), typingMs(rows[reveal.shown].content));
    return () => clearTimeout(t);
  }, [reveal, v?.messages]);

  async function patch(body: object) {
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`, { method: "PATCH", ...json({ ...body, version: v?.version }) });
    if (r.ok) { setV(r.data); setError(null); return true; }
    setError(r.error); load(); return false;
  }

  // Text mode double-text: after a reply, while the tab is visible and the user isn't typing, the character may follow up once.
  const lastMsg = v?.messages.at(-1);
  const nudgeArmed = modeOf(v?.chat.style) === "text" && !busy && !input && v?.chat.doubleText !== 0 && lastMsg?.role === "assistant"
    && v?.messages.find((m) => m.burstId && m.burstId === lastMsg.burstId)?.nudge !== 1;
  useEffect(() => {
    if (!nudgeArmed) return;
    const t = setTimeout(() => { if (document.visibilityState === "visible") send({ nudge: true }); }, (120 + Math.random() * 240) * 1000);
    return () => clearTimeout(t);
  }, [nudgeArmed, v?.version]); // eslint-disable-line react-hooks/exhaustive-deps -- re-arm per chat version only

  async function send(body: { text?: string; regenerate?: number; wild?: boolean; retry?: boolean; nudge?: boolean }) {
    if (!v || busy) return;
    pinned.current = true;
    setError(null); setStatus("Thinking…");
    setStream({ text: "", replacing: body.regenerate });
    if (body.text) setV({ ...v, messages: [...v.messages, { id: -1, chatId, role: "user", content: body.text, swipes: [], activeSwipeIndex: 0, createdAt: Date.now(), updatedAt: Date.now(), thought: "", burstId: null, burstSwipes: null, speaker: "", reaction: "", imageId: null }] });
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
      if (!body.nudge) setError((e as Error).message); // a refused nudge is silent
      // Not sent (conflict, offline…): give the typed text back instead of losing it.
      if (body.text) setInput((cur) => cur || body.text!);
    }
    setStream(null); setStatus(null);
    const r = await requestJson<View>(`/api/rp/chats/${chatId}`);
    if (r.ok) {
      setV(r.data);
      const last = r.data.messages.at(-1), seen = Math.max(0, ...v.messages.map((m) => m.id));
      const head = last?.burstId ? r.data.messages.find((m) => m.burstId === last.burstId) : undefined;
      if (head && (head.id > seen || body.regenerate)) setReveal({ id: head.burstId!, shown: 0 });
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
  const style = modeOf(v?.chat.style);
  const lastBurst = msgs.at(-1)?.burstId ?? null;
  const burstHead = lastBurst ? msgs.find((m) => m.burstId === lastBurst) : undefined;
  const texting = style === "text" && (!!stream || !!reveal);
  // Hidden while typing: the burst being regenerated, and bubbles not revealed yet.
  const hidden = (m: RpMessage) => !!m.burstId && ((style === "text" && stream?.replacing !== undefined && m.burstId === lastBurst)
    || (reveal?.id === m.burstId && msgs.filter((x) => x.burstId === m.burstId).indexOf(m) >= reveal.shown));

  return (
    <section ref={root} data-rp-chat aria-label={`Chat with ${name}`} className="flex min-h-[calc(100dvh_-_var(--pt)_-_env(safe-area-inset-top))] flex-col gap-2"
      style={{ paddingBottom: "calc(var(--composer-h, 60px) + env(safe-area-inset-bottom) + 22px)" }}>
      <header data-compact={compact || undefined} className="group sticky top-0 z-10 -mx-4 flex items-center gap-2 px-4 py-1 transition-colors duration-200 data-[compact]:bg-bg/85 data-[compact]:backdrop-blur">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="border-border grid size-10 place-items-center rounded-full border">‹</button>
        <div aria-hidden={!compact} className="flex min-w-0 flex-1 items-center gap-2 opacity-0 transition-opacity duration-[180ms] group-data-[compact]:opacity-100">
          <Avatar c={character} size="size-[34px] shadow-[0_0_14px] shadow-accent/50" />
          <div className="min-w-0">
            <p className="truncate font-serif text-[15px]">{name}</p>
            <p role="status" className="text-accent h-4 text-[10.5px]">{busy ? (texting ? "typing…" : "writing…") : ""}</p>
          </div>
        </div>
        {v && <button type="button" onClick={() => setTuning(true)} className={`h-9 rounded-full border px-3 text-xs transition-colors ${enabledMods(v.chat, v.globalMods) ? "border-accent text-accent" : "border-border"}`}>
          Tune{enabledMods(v.chat, v.globalMods) ? <span key={enabledMods(v.chat, v.globalMods)} className="animate-pop ml-1">· {enabledMods(v.chat, v.globalMods)}</span> : null}</button>}
        {v && <button type="button" onClick={() => setTuning(true)} aria-label="Lorebooks" className="border-border h-9 rounded-full border px-3 text-xs">📖</button>}
        <details className="relative">
          <summary aria-label="More" className="border-border grid size-9 cursor-pointer list-none place-items-center rounded-full border [&::-webkit-details-marker]:hidden">⋯</summary>
          <div className="glass absolute top-11 right-0 z-20 w-60 space-y-2 rounded-2xl p-2 text-sm">
            {personas.length > 1 && v ? (
              <select value={v.chat.personaId ?? ""} disabled={busy} onChange={(e) => patch({ op: "chat", personaId: Number(e.target.value) || null })} aria-label="You are"
                className="h-10 w-full rounded-lg bg-transparent px-2">{personas.map((p) => <option key={p.id} value={p.id}>as {p.name}</option>)}</select>
            ) : <p className="text-muted px-2 py-1 text-xs">as {persona?.name ?? "User"}</p>}
            {v && <div role="radiogroup" aria-label="Mode" className="border-border flex rounded-full border p-0.5">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={style === m.id} title={m.blurb} disabled={busy || style === m.id} onClick={() => patch({ op: "chat", style: m.id })}
                  className={`min-h-10 flex-1 rounded-full px-2.5 text-xs whitespace-nowrap transition-colors ${style === m.id ? "bg-accent text-accent-fg font-semibold" : "text-muted"}`}>{m.label}</button>
              ))}
            </div>}
            <button type="button" onClick={onEdit} className="h-10 w-full rounded-lg px-2 text-left">Card</button>
          </div>
        </details>
      </header>

      <div ref={stage} className="-mx-4 flex flex-col items-center gap-1 pb-4 text-center" style={{ background: "radial-gradient(circle at 50% 75%, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent 70%)" }}>
        <Avatar c={character} size="h-[210px] w-[140px] rounded-t-full! rounded-b-2xl! text-5xl bg-linear-to-br from-accent to-cyan text-accent-fg!" shared />
        <h1 style={vt("name", character)} className="mt-2 font-serif text-[22px]">{name}</h1>
        {character.scenario && <p className="text-muted line-clamp-1 px-8 text-xs">{sub(character.scenario)}</p>}
      </div>

      <div className="flex-1 space-y-3">
        {msgs.map((m) => {
          if (hidden(m)) return null;
          const replacing = style !== "text" && stream?.replacing === m.id;
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
              {m.id === lastId && burstHead && (burstHead.burstSwipes?.length ?? 0) > 1 && (
                <span data-noswipe className="flex items-center gap-1 font-mono">
                  <button type="button" aria-label="Previous set" disabled={burstHead.activeSwipeIndex === 0} onClick={() => patch({ op: "burstSwipe", msgId: burstHead.id, index: burstHead.activeSwipeIndex - 1 })} className="grid size-8 place-items-center disabled:opacity-30">‹</button>
                  {burstHead.activeSwipeIndex + 1}/{burstHead.burstSwipes!.length}
                  <button type="button" aria-label="Next set" disabled={burstHead.activeSwipeIndex >= burstHead.burstSwipes!.length - 1} onClick={() => patch({ op: "burstSwipe", msgId: burstHead.id, index: burstHead.activeSwipeIndex + 1 })} className="grid size-8 place-items-center disabled:opacity-30">›</button>
                </span>
              )}
              {m.role === "assistant" && <>
                <button type="button" aria-label="Like reply" aria-pressed={rated[m.id] === "like"} disabled={!!rated[m.id]} onClick={() => rate(m.id, "like")} className={rated[m.id] === "like" ? "text-ok" : ""}>👍</button>
                <button type="button" aria-label="Dislike reply" aria-pressed={rated[m.id] === "dislike"} disabled={!!rated[m.id]} onClick={() => rate(m.id, "dislike")} className={rated[m.id] === "dislike" ? "text-danger" : ""}>👎</button>
              </>}
              {m.role === "assistant" && m.id === lastId && <>
                <button type="button" onClick={() => send({ regenerate: m.id })}>Regenerate</button>
                <button type="button" onClick={() => send({ regenerate: m.id, wild: true })} title="A much bolder, unpredictable take">🎲 Wild</button>
              </>}
              <button type="button" onClick={() => setEditing({ id: m.id, text: m.content })}>Edit</button>
              {m.id !== lastId && <button type="button" onClick={() => setRewind(m.id)}>Rewind here</button>}
              {m.thought && <button type="button" aria-expanded={thoughtOf === m.id} onClick={() => setThoughtOf(thoughtOf === m.id ? null : m.id)}>💭 Thought</button>}
              {thoughtOf === m.id && <p className="text-muted basis-full px-2 pb-1 whitespace-pre-wrap italic">{m.thought}</p>}
            </div>
          );
          return m.role === "user" ? (
            <div key={m.id} className={`animate-rise space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_200px] ${style === "text" ? "bg-accent text-accent-fg ml-auto w-fit max-w-[85%] rounded-[18px_18px_5px_18px] px-3.5 py-2.5" : "bg-accent/15 ml-auto w-fit max-w-[78%] rounded-[16px_16px_4px_16px] px-3 py-2 text-[13.5px]"}`}><Prose text={sub(m.content)} />{actions}{m.reaction && <span aria-label={`Reacted ${m.reaction}`} className="bg-surface border-border -mb-4 ml-auto block w-fit rounded-full border px-1.5 text-sm">{m.reaction}</span>}</div>
          ) : (
            <div key={m.id} className={`animate-rise flex gap-2 [content-visibility:auto] [contain-intrinsic-size:auto_200px]`}>
              {style === "text" && <Avatar c={character} size="size-8" />}
              <div className={`min-w-0 flex-1 ${style === "text" ? "space-y-1.5 text-[15px] leading-relaxed" : ""}`}>
                {style !== "text" && <p className="mb-1 flex items-center gap-[7px]"><Avatar c={character} size="size-[22px]" /><span className="text-accent text-[11px] font-semibold tracking-[.06em] uppercase">{m.speaker || name}</span></p>}
                {style === "text" && m.speaker && <p className="text-muted flex items-center gap-1.5 text-[11px] font-semibold"><i aria-hidden="true" className="size-2 rounded-full" style={{ background: `hsl(${[...m.speaker].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 360} 65% 55%)` }} />{m.speaker}</p>}
                <div key={replacing ? "stream" : m.activeSwipeIndex} data-style={style || undefined} className={`animate-fade ${style === "text" ? "space-y-1.5" : "border-accent/35 border-l-2 pl-3"} ${replacing ? "stream-caret" : ""}`}>
                  {m.imageId === null || replacing ? <Prose text={sub(replacing ? stream!.text || "…" : m.content)} />
                    : m.imageFile ? <button type="button" onClick={() => setZoom(m.imageFile!)} className="block w-fit"><img src={`/api/rp/files/images/${m.imageFile}`} alt="Photo" className="max-h-80 rounded-2xl" /></button>
                    : <p className="text-muted bg-surface-2 w-fit rounded-2xl px-3.5 py-2.5 text-sm">{m.imageId === 0 ? "📷 photo failed" : "📷 sending…"}</p>}
                </div>
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
        {texting && (
          <div className="animate-rise flex gap-2" aria-hidden="true">
            <Avatar c={character} size="size-8" />
            <span className="thinking bg-surface-2 flex w-fit gap-1 rounded-2xl rounded-bl-md px-3.5 py-3">{[0, 1, 2].map((n) => <i key={n} className="bg-muted size-1.5 rounded-full" />)}</span>
          </div>
        )}
        {stream && stream.replacing === undefined && style !== "text" && (
          <div className="animate-rise">
            <p className="mb-1 flex items-center gap-[7px]"><Avatar c={character} size="size-[22px]" /><span className="text-accent text-[11px] font-semibold tracking-[.06em] uppercase">{name}</span></p>
            <div data-style={style || undefined} className="stream-caret border-accent/35 min-w-0 border-l-2 pl-3">{stream.text ? <Prose text={sub(stream.text)} /> : <p className="thinking text-muted text-sm">…</p>}</div>
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
        {zoom && <button type="button" aria-label="Close photo" onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"><img src={`/api/rp/files/images/${zoom}`} alt="Photo" className="max-h-full max-w-full object-contain" /></button>}
      <div ref={end} />
      </div>

      {away && (busy || !!stream) && <button type="button" onClick={() => { pinned.current = true; setAway(false); end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }}
        className="glass text-accent-ink animate-rise fixed bottom-[calc(var(--composer-h,60px)+env(safe-area-inset-bottom)+22px)] left-1/2 z-20 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs">↓ Latest</button>}
      <form ref={form} data-composer className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-20 mx-auto flex max-w-3xl items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea ref={composer} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={`Message ${name}…`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); submit(); } }}
          className="glass focus:border-accent max-h-[calc(5lh+20px)] min-w-0 flex-1 resize-none overflow-y-auto rounded-[22px] px-3.5 py-2.5 text-base transition-colors" />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="bg-accent text-accent-fg grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      {v && <TuneSheet open={tuning} onClose={() => setTuning(false)} chat={v.chat} globalMods={v.globalMods} thinking={v.thinking} agency={character.agency} sub={sub} onPatch={patch} />}
      {sheet}
    </section>
  );
}
