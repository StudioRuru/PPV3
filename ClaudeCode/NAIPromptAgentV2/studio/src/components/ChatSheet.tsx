"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg, Mode } from "@/lib/copilot-prompt";
import { requestJson } from "@/lib/net";
import { inline, mdBlocks } from "@/lib/md";
import { parseReply, type Op } from "@/lib/patch";
import type { PromptState } from "@/lib/prompt";
import { PatchCard } from "./PatchCard";
import { Sheet } from "./Sheet";

type Status = { on: boolean; brain: boolean; caption: boolean; tipo: boolean; power?: boolean; error?: string };
export type ChatSeed = { text: string; image?: File; tags?: string } | null;

const MODES: [Mode, string][] = [["character", "Create character"], ["scene", "Build scene"], ["theme", "Theme"], ["arc", "Arc step"], ["cluster", "Cluster these tags"]];

export function ChatSheet({ open, onClose, state, onApply, seed }: {
  open: boolean; onClose: () => void; state: PromptState; onApply: (ops: Op[]) => void; seed: ChatSeed;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [toggling, setToggling] = useState<{ verb: string; since: number } | null>(null);
  const [, tick] = useState(0);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [busy, setBusy] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // send() may run from the seed effect's stale closure: read live messages from the ref, not the render.
  const msgsRef = useRef<ChatMsg[]>([]);
  msgsRef.current = msgs;

  useEffect(() => {
    if (!open) return;
    requestJson<Status>("/api/copilot").then((r) => r.ok && setStatus(r.data));
    requestJson<{ messages: ChatMsg[] }>("/api/chat/history").then((r) => r.ok && setMsgs((cur) => (cur.length ? cur : r.data.messages)));
  }, [open]);
  // Mounted while closed (to animate out): only scroll when visible, and catch up on open.
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  useEffect(() => {
    if (!toggling) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [toggling]);

  async function toggle() {
    const on = !status?.on;
    setToggling({ verb: on ? (status?.power ? "Starting" : "Loading") : "Stopping", since: Date.now() });
    const r = await requestJson<Status>("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
    // A failed POST carries no status: re-read the real one rather than guessing it's off.
    const s = r.ok ? r.data : await requestJson<Status>("/api/copilot").then((g) => (g.ok ? g.data : status));
    setToggling(null);
    setStatus({ ...(s ?? { on: false, brain: false, caption: false, tipo: false }), error: r.ok ? undefined : r.error });
  }

  async function send(text: string, m: Mode = mode) {
    if (!text.trim() || busy) return;
    if (!msgsRef.current.length) {
      const h = await requestJson<{ messages: ChatMsg[] }>("/api/chat/history");
      if (h.ok) msgsRef.current = h.data.messages;
    }
    const history: ChatMsg[] = [...msgsRef.current, { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput(""); setBusy("Thinking…");
    let reply = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, state, mode: m }) });
      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body).error ?? body; } catch { /* plain-text error */ }
        throw new Error(res.status === 401 ? "Session expired — reload the page and sign in again." : msg || `Server error ${res.status}.`);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += dec.decode(value, { stream: true });
        setBusy(null);
        setMsgs([...history, { role: "assistant", content: reply }]);
      }
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: `${reply}\n\n⚠️ ${(e as Error).message || "Network error — tap send to retry."}` }]);
    }
    setBusy(null); setMode("chat");
  }

  // Seeds come from the tagger ("Make this a scene"): caption the image first, then ask for a scene.
  useEffect(() => {
    if (!seed) return;
    (async () => {
      let text = seed.text;
      if (seed.image && status?.caption !== false) {
        setBusy("Reading the image…");
        const fd = new FormData(); fd.append("file", seed.image); fd.append("tags", seed.tags ?? "");
        const r = await requestJson<{ caption: string }>("/api/caption", { method: "POST", body: fd });
        setBusy(null);
        if (r.ok) text += `\n\nImage caption:\n${r.data.caption}`;
      }
      send(text, "scene");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per seed
  }, [seed]);

  const offline = status && !status.brain;
  const thumbOn = toggling ? toggling.verb !== "Stopping" : !!status?.on;
  const dots: [string, boolean, boolean?][] = status ? [["brain", status.on, status.brain], ["caption", status.caption], ["tipo", status.tipo]] : [];
  return (
    <Sheet open={open} onClose={onClose} label="Co-pilot chat" closeLabel="Close chat"
      className="h-[88dvh] rounded-t-2xl border-t lg:h-full lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="text-base font-semibold whitespace-nowrap">Co-pilot</h2>
          <span className="text-muted flex min-w-0 flex-1 gap-2.5 overflow-hidden font-mono text-[11px]">
            {status ? dots.map(([name, up, half], i) => (
              <span key={name} className="flex items-center gap-1 whitespace-nowrap">
                {/* Keyed on state so a change remounts the dot and replays the settle pop. */}
                <i key={`${up}${half}`} aria-hidden="true" style={toggling ? { animationDelay: `${i * 180}ms` } : undefined}
                  className={`size-1.5 rounded-full ${up ? "bg-ok" : half ? "bg-warn" : "bg-border"} ${toggling ? "dot-breathe" : "dot-settle"}`} />
                {name}<span className="sr-only">{up ? " up" : half ? " idle" : " down"}</span>
              </span>
            )) : "…"}
          </span>
          <button type="button" role="switch" aria-checked={!!status?.on} disabled={!!toggling || (!!offline && !status?.power)} onClick={toggle}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-semibold tabular-nums disabled:opacity-60 ${status?.on && !toggling ? "border-accent/60 text-fg" : "border-border"}`}>
            {/* The thumb travels to where it's headed as soon as you flip it, and breathes until the servers answer. */}
            <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${thumbOn ? "bg-accent" : "bg-surface-2"}`}>
              <span className={`bg-fg absolute top-1 left-1 size-5 rounded-full shadow transition-[translate] duration-300 ease-[var(--ease-settle)] ${thumbOn ? "translate-x-5" : ""} ${toggling ? "dot-breathe" : ""}`} />
            </span>
            {toggling ? `${toggling.verb}… ${Math.round((Date.now() - toggling.since) / 1000)}s` : status?.on ? "On" : "Off"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
        </header>
        {(offline || status?.error) && <p role="alert" className="text-danger px-3 pb-2 text-sm">{status?.error ?? (status?.power ? "Servers are off — flip the switch to start them." : "Brain offline — run `npm run up` on the Mac.")}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3">
          {msgs.length === 0 && <p className="text-muted text-sm">Ask for a character, a scene, a theme or the next arc step. Suggested changes arrive as cards you can apply.</p>}
          {msgs.map((m, i) => {
            const p = m.role === "assistant" ? parseReply(m.content) : null;
            return (
              <div key={i} className={`animate-rise ${m.role === "user" ? "bg-surface-2 ml-8 rounded-lg p-2.5 text-sm whitespace-pre-wrap" : "space-y-1.5 text-sm leading-relaxed"}`}>
                {p ? <Md text={p.prose} /> : m.content}
                {p?.error && <p className="text-danger mt-1 text-xs">{p.error}</p>}
                {p && p.ops.length > 0 && <PatchCard ops={p.ops} onApply={() => onApply(p.ops)} />}
              </div>
            );
          })}
          {busy && (
            <p role="status" className="text-muted animate-rise flex items-center gap-2 text-sm">
              <span aria-hidden="true" className="thinking flex gap-1">{[0, 1, 2].map((n) => <i key={n} className="bg-accent size-1.5 rounded-full" />)}</span>
              {busy}
            </p>
          )}
          <div ref={end} />
        </div>
        <div className="border-border space-y-2 border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <div className="flex gap-1.5 overflow-x-auto">
            {MODES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(mode === k ? "chat" : k)}
                className={`h-9 shrink-0 rounded-full px-3 text-xs ${mode === k ? "bg-accent text-accent-fg" : "border-border border"}`}>{label}</button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={status?.on ? "Describe what you want…" : "Turn the co-pilot on to chat"}
              disabled={!status?.on} className="bg-bg border-border flex-1 rounded-md border px-2 py-2 text-base" />
            <button type="submit" disabled={!status?.on || !!busy || !input.trim()} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
          </form>
        </div>
    </Sheet>
  );
}

function Runs({ text }: { text: string }) {
  return <>{inline(text).map((r, i) => (r.b ? <strong key={i} className="font-semibold">{r.t}</strong> : r.i ? <em key={i}>{r.t}</em> : r.t))}</>;
}

function Md({ text }: { text: string }) {
  return <>{mdBlocks(text).map((b, i) =>
    b.kind === "h" ? <h3 key={i} className="text-accent pt-1 text-xs font-semibold tracking-wide uppercase"><Runs text={b.text} /></h3>
    : b.kind === "li" ? <p key={i} className="flex gap-2 pl-1"><span aria-hidden="true" className="text-muted">•</span><span><Runs text={b.text} /></span></p>
    : <p key={i} className="whitespace-pre-wrap"><Runs text={b.text} /></p>)}</>;
}
