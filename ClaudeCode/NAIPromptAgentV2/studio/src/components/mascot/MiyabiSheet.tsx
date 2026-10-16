"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/lib/copilot-prompt";
import { emitMascot } from "@/lib/mascot/bus";
import { pickSprite, type Outfit } from "@/lib/mascot/core";
import { requestJson } from "@/lib/net";
import { learnTags, parseReply, type Op } from "@/lib/patch";
import { visibleWhileStreaming } from "@/lib/mascot/talk";
import type { PromptState } from "@/lib/prompt";
import { Md } from "../ChatScreen";
import { PatchCard } from "../PatchCard";
import { Sheet } from "../Sheet";
import { SlidersPanel } from "./SlidersPanel";

type Thread = { id: number; persona: string; updated_at: number };
type Msg = ChatMsg & { cid: string; error?: boolean };
const withId = (m: ChatMsg & { error?: boolean }): Msg => ({ ...m, cid: crypto.randomUUID() });
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Deep talk: a Chat 2.0 thread with persona `miyabi`, answered on the heavy model; change replies come as PatchCards. */
export function MiyabiSheet({ open, onClose, outfit, state, onApply }: { open: boolean; onClose: () => void; outfit: Outfit; state: PromptState; onApply: (ops: Op[]) => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false); // whole reply, not just until the first chunk
  const [rated, setRated] = useState<Record<string, "like" | "dislike">>({});
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [mood, setMood] = useState(false); // sliders popover
  const moodBtn = useRef<HTMLButtonElement>(null), moodBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mood) return;
    moodBox.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMood(false); };
    window.addEventListener("keydown", esc);
    const btn = moodBtn.current;
    return () => { window.removeEventListener("keydown", esc); btn?.focus(); };
  }, [mood]);
  const end = useRef<HTMLDivElement>(null);
  const tidRef = useRef<number | null>(null); // the talk on screen: a reply only paints into its own talk

  async function load(id: number) {
    tidRef.current = id;
    const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads");
    if (r.ok && tidRef.current === id) setThread(r.data.threads.find((t) => t.id === id) ?? null);
    const h = await requestJson<{ messages: ChatMsg[] }>(`/api/chat/history?thread=${id}`);
    if (h.ok && tidRef.current === id) setMsgs(h.data.messages.map(withId));
  }
  async function newTalk() {
    const r = await requestJson<{ id: number }>("/api/chat/threads", json({ persona: "miyabi" }));
    if (r.ok) { setRated({}); await load(r.data.id); }
  }
  useEffect(() => {
    if (!open) return;
    requestJson<{ sprites: Record<string, number> }>("/api/mascot/sprites").then((r) => r.ok && setSprites(r.data.sprites));
    // Her most recent talk, or a new one on first open.
    requestJson<{ threads: Thread[] }>("/api/chat/threads").then((r) => {
      if (!r.ok) return;
      const last = r.data.threads.find((t) => t.persona === "miyabi");
      if (last) load(last.id); else newTalk();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load/newTalk only touch state setters
  }, [open]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !thread) return;
    let id = thread.id;
    const show = (ms: Msg[]) => { if (tidRef.current === id) setMsgs(ms); };
    const history = [...msgs.filter((m) => !m.error), withId({ role: "user", content: text })];
    const reply = withId({ role: "assistant", content: "" });
    setInput(""); show([...history, reply]); setBusy("Thinking…"); setStreaming(true);
    let out = "";
    try {
      const res = await fetch("/api/chat", json({ thread: id, version: thread.updated_at, messages: history.map(({ role, content }) => ({ role, content })), state, mode: "chat", persona: "miyabi" }));
      if (res.status === 409) {
        await load(id);
        if (tidRef.current === id) setMsgs((ms) => [...ms, withId({ role: "assistant", content: "⚠️ This talk changed on another device — reloaded. Send again.", error: true })]);
        setBusy(null); setStreaming(false); return;
      }
      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body).error ?? body; } catch { /* plain text */ }
        throw new Error(res.status === 401 ? "Session expired — reload the page and sign in again." : msg || `Server error ${res.status}.`);
      }
      // Talk deleted elsewhere: the server answered in a new thread; follow it if she's still on screen.
      const realId = Number(res.headers.get("X-Thread"));
      if (realId && realId !== id) { if (tidRef.current === id) tidRef.current = realId; id = realId; }
      if (res.headers.get("X-Paused") === "1") setBusy("Pausing captioner + TIPO for the heavy model…");
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += dec.decode(value, { stream: true });
        setBusy(null); show([...history, { ...reply, content: out }]);
      }
      if (/\n\n⚠️ [^\n]*$/.test(out)) show([...history, { ...reply, content: out, error: true }]);
    } catch (e) {
      show([...history, { ...reply, content: `${out}\n\n⚠️ ${(e as Error).message || "Network error — tap send to retry."}`, error: true }]);
    }
    setBusy(null); setStreaming(false);
    if (tidRef.current === id) load(id); // fresh version for the next send
  }

  function taste(kind: "like" | "dislike" | "apply", ops: Op[]) {
    requestJson("/api/taste", json({ event: { kind, tags: learnTags(ops), note: "", persona: "miyabi" } }));
  }
  function rate(m: Msg, kind: "like" | "dislike") {
    if (rated[m.cid]) return;
    setRated({ ...rated, [m.cid]: kind });
    taste(kind, parseReply(m.content).ops);
  }
  function apply(ops: Op[]) {
    onApply(ops);
    emitMascot("applied", { ops: ops.map((o) => `${o.action} ${o.target}: ${o.line}`) });
    taste("apply", ops);
  }

  const have = new Set(Object.keys(sprites));
  const sprite = have.has(`${outfit}/full`) ? `${outfit}/full` : pickSprite(have, outfit, "smug");

  return (
    <Sheet open={open} onClose={onClose} label="Talk to Miyabi" closeLabel="Close Miyabi"
      className="h-[92dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-md lg:rounded-none lg:border-l">
      <header className="relative flex items-center gap-2 px-3 pb-2">
        <h2 className="flex-1 text-base font-semibold">Miyabi</h2>
        <button ref={moodBtn} type="button" aria-expanded={mood} aria-haspopup="dialog" onClick={() => setMood(!mood)}
          className={`border-border relative z-30 h-11 rounded-full border px-3 text-xs font-semibold ${mood ? "bg-accent text-accent-fg" : "text-muted"}`}>Mood</button>
        <button type="button" disabled={streaming} onClick={newTalk} className="border-border text-accent relative z-30 h-9 rounded-full border px-3 text-xs font-semibold disabled:opacity-40">New talk</button>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border relative z-30 h-11 w-11 rounded-full border">×</button>
        {mood && (
          <>
            <button type="button" aria-label="Close mood" className="fixed inset-0 z-10 cursor-default" onClick={() => setMood(false)} />
            <div ref={moodBox} tabIndex={-1} role="dialog" aria-label="Personality sliders"
              className="bg-surface border-border absolute inset-x-3 top-full z-20 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-lg outline-none">
              <SlidersPanel open={open} />
            </div>
          </>
        )}
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
        <div className="flex justify-center">
          {sprite
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/mascot/sprites/${sprite}?v=${sprites[sprite]}`} alt="Miyabi" className="h-56 w-auto drop-shadow-lg" />
            : <span className="bg-accent-soft text-accent-ink border-border flex size-24 items-center justify-center rounded-full border text-4xl font-semibold">M</span>}
        </div>
        {msgs.length === 0 && <p className="text-muted text-center text-sm">Talk to her properly — or ask her to fix your prompt.</p>}
        {msgs.map((m) => {
          if (m.role === "user") return <p key={m.cid} className="animate-rise bg-surface-2 ml-8 rounded-lg p-2.5 text-sm whitespace-pre-wrap">{m.content}</p>;
          const p = parseReply(visibleWhileStreaming(m.content));
          return (
            <div key={m.cid} className={`animate-rise space-y-1.5 text-sm leading-relaxed ${m.error ? "text-danger" : ""}`}>
              <Md text={p.prose} />
              {p.error && <p className="text-danger mt-1 text-xs">{p.error}</p>}
              {p.ops.length > 0 && <PatchCard ops={p.ops} onApply={apply} />}
              {!streaming && m.content && !m.error && (
                <div className="text-faint flex gap-3 text-xs">
                  <button type="button" aria-label="Like reply" aria-pressed={rated[m.cid] === "like"} disabled={!!rated[m.cid]} onClick={() => rate(m, "like")} className={rated[m.cid] === "like" ? "text-ok" : ""}>👍</button>
                  <button type="button" aria-label="Dislike reply" aria-pressed={rated[m.cid] === "dislike"} disabled={!!rated[m.cid]} onClick={() => rate(m, "dislike")} className={rated[m.cid] === "dislike" ? "text-danger" : ""}>👎</button>
                </div>
              )}
            </div>
          );
        })}
        {busy && <p role="status" className="text-muted animate-rise text-sm">{busy}</p>}
        <div ref={end} />
      </div>
      {/* Hidden when closed: the sheet only hides with visibility, which would still count toward Mascot's composer height. */}
      <form data-composer className={`border-border gap-2 border-t p-3 ${open ? "flex" : "hidden"}`} style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Say something to her…" aria-label="Message Miyabi"
          className="bg-bg border-border min-w-0 flex-1 resize-none rounded-md border px-2 py-2.5 text-base" />
        <button type="submit" disabled={streaming || !thread || !input.trim()} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
      </form>
    </Sheet>
  );
}
