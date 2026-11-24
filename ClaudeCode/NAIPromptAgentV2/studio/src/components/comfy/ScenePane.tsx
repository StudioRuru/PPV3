"use client";
import { useEffect, useRef, useState } from "react";
import { TARGETS, type SceneChat, type SceneOut, type SceneTurn, type Target } from "@/lib/comfy/scene";
import { splitSceneStream } from "@/lib/comfy/scene-ui";
import { requestJson } from "@/lib/net";

const ORDER: Target[] = ["anime", "photo", "video"];
const btn = "border-border h-9 rounded-full border px-4 text-sm";

/** Scene sub-tab: plain-text scene in, model-ready prompt out; the chat lives server-side (GET on mount, DELETE = New scene). */
export function ScenePane({ onSendPhoto, onSendVideo }: { onSendPhoto(out: SceneOut): Promise<string | null>; onSendVideo(out: SceneOut): void }) {
  const [turns, setTurns] = useState<SceneTurn[]>([]);
  const [target, setTarget] = useState<Target>("anime");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  const flight = useRef(false); // one send or reset at a time
  const [sendErr, setSendErr] = useState<string | null>(null);
  const busy = live !== null;

  useEffect(() => {
    alive.current = true;
    void requestJson<{ chat: SceneChat; models: string[] }>("/api/comfy/scene").then((r) => {
      if (!alive.current || !r.ok) return;
      setTurns(r.data.chat.turns); setTarget(r.data.chat.target); setModels(r.data.models);
      setModel(r.data.models.includes(r.data.chat.model) ? r.data.chat.model : r.data.models[0] ?? "");
    });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [turns, live]);

  async function send() {
    const text = input.trim();
    if (!text || flight.current) return;
    flight.current = true;
    setInput(""); setError(null); setSendErr(null); setLive("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    let raw = "", started = false;
    try {
      const res = await fetch("/api/comfy/scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, target, ...(model ? { model } : {}) }) });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        let msg = "";
        try { const j = JSON.parse(body); msg = typeof j.error === "string" ? j.error : ""; } catch { /* not JSON */ }
        throw new Error(res.status === 400 ? msg || "Request rejected" : `Request failed (${res.status})`);
      }
      started = true;
      const rd = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        if (alive.current) setLive(raw.split("\u0000")[0].split(/```json/i)[0]);
      }
      const { prose, out, dropped } = splitSceneStream(raw);
      if (alive.current) setTurns((t) => [...t, { role: "assistant", content: prose, ...(out ? { out } : {}), ...(dropped.length ? { dropped } : {}) }]);
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Request failed");
        if (!started) { setTurns((t) => t.slice(0, -1)); setInput(text); } // nothing was sent: undo the bubble
      }
    } finally {
      flight.current = false;
      if (alive.current) setLive(null);
    }
  }

  async function reset() {
    if (flight.current) return;
    flight.current = true;
    try {
      const r = await requestJson<{ ok: boolean }>("/api/comfy/scene", { method: "DELETE" });
      if (!r.ok) return setError(r.error);
      setTurns([]); setError(null); setSendErr(null);
    } finally { flight.current = false; }
  }

  const sendPhoto = async (o: SceneOut) => setSendErr(await onSendPhoto(o));
  const sendVideo = (o: SceneOut) => { setSendErr(null); onSendVideo(o); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Scene target" className="flex gap-2">
          {ORDER.map((t) => (
            <button key={t} type="button" aria-pressed={target === t} onClick={() => setTarget(t)}
              className={`${btn} ${target === t ? "bg-accent text-accent-fg border-accent font-semibold" : "text-muted"}`}>{TARGETS[t].label}</button>
          ))}
        </div>
        {models.length > 0 && (
          <select aria-label="Writer model" value={model} onChange={(e) => setModel(e.target.value)}
            className="bg-surface border-border h-9 min-w-0 flex-1 rounded-full border px-3 text-sm">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-4">
        {turns.length === 0 && live === null && <p className="text-muted text-sm">Describe a scene. I will write the prompt for the {TARGETS[target].label} target.</p>}
        {turns.map((m, i) => m.role === "user"
          ? <p key={i} className="bg-accent-soft ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm break-words whitespace-pre-wrap">{m.content}</p>
          : <Reply key={i} turn={m} onSendPhoto={sendPhoto} onSendVideo={sendVideo} />)}
        {live !== null && (
          <div className="stream-caret border-accent/35 min-w-0 border-l-2 pl-3">
            {live ? <p className="text-sm break-words whitespace-pre-wrap">{live}</p> : <p className="thinking text-muted text-sm">…</p>}
          </div>
        )}
        {sendErr && <p role="alert" className="text-danger text-sm break-words">⚠️ {sendErr}</p>}
        {error && <p role="alert" className="text-danger text-sm break-words">⚠️ {error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
        <button type="button" onClick={reset} disabled={busy || turns.length === 0} className={`${btn} text-muted shrink-0 disabled:opacity-50`}>New scene</button>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={4000} placeholder="Describe the scene…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          className="glass focus:border-accent max-h-[calc(5lh+20px)] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto rounded-[22px] px-3.5 py-2.5 text-base transition-colors" />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="bg-accent text-accent-fg grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  );
}

function Reply({ turn, onSendPhoto, onSendVideo }: { turn: SceneTurn; onSendPhoto(o: SceneOut): void | Promise<void>; onSendVideo(o: SceneOut): void }) {
  const out = turn.out;
  return (
    <div className="border-accent/35 min-w-0 space-y-2 border-l-2 pl-3">
      {turn.content && <p className="text-sm break-words whitespace-pre-wrap">{turn.content}</p>}
      {out && (
        <>
          <pre className="bg-surface-2 border-border rounded-lg border p-2.5 font-mono text-xs break-words whitespace-pre-wrap">{out.prompt}</pre>
          {out.target === "video" && out.beats && out.beats.length > 0 && (
            <ul className="text-muted space-y-1 text-sm">{out.beats.map((b, i) => <li key={i} className="break-words">{b.from}–{b.to} s · {b.text}</li>)}</ul>
          )}
          {out.loras.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{out.loras.map((l) => <span key={l.name} className="bg-accent-soft text-accent-ink max-w-full rounded-full px-2.5 py-1 text-xs break-all">{l.name} × {l.strength}</span>)}</div>
          )}
          {turn.dropped && turn.dropped.length > 0 && <p className="text-faint text-xs break-words">dropped: {turn.dropped.join(", ")}</p>}
          <button type="button" onClick={() => (out.target === "video" ? onSendVideo(out) : onSendPhoto(out))}
            className="bg-accent text-accent-fg h-9 rounded-full px-4 text-sm font-semibold">{out.target === "video" ? "Send to Video" : "Send to Photo"}</button>
        </>
      )}
    </div>
  );
}
