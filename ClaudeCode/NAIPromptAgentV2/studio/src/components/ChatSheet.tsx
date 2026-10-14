"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg, Mode } from "@/lib/copilot-prompt";
import { requestJson } from "@/lib/net";
import { parseReply, type Op } from "@/lib/patch";
import type { PromptState } from "@/lib/prompt";
import { PatchCard } from "./PatchCard";

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
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);
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
      if (!res.ok || !res.body) throw new Error(await res.text());
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

  if (!open) return null;
  const offline = status && !status.brain;
  const dots: [string, boolean, boolean?][] = status ? [["brain", status.on, status.brain], ["caption", status.caption], ["tipo", status.tipo]] : [];
  return (
    <div className="fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-label="Co-pilot chat">
      <button type="button" aria-label="Close chat" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <section className="bg-surface border-border relative flex h-[88dvh] w-full flex-col rounded-t-2xl border-t lg:h-full lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="text-base font-semibold whitespace-nowrap">Co-pilot</h2>
          <span className="text-muted flex min-w-0 flex-1 gap-2.5 overflow-hidden font-mono text-[11px]">
            {status ? dots.map(([name, up, half]) => (
              <span key={name} className="flex items-center gap-1 whitespace-nowrap">
                <i aria-hidden="true" className={`size-1.5 rounded-full ${up ? "bg-ok" : half ? "bg-warn" : "bg-border"} ${toggling ? "animate-pulse" : ""}`} />
                {name}<span className="sr-only">{up ? " up" : half ? " idle" : " down"}</span>
              </span>
            )) : "…"}
          </span>
          <button type="button" role="switch" aria-checked={!!status?.on} disabled={!!toggling || (!!offline && !status?.power)} onClick={toggle}
            className={`h-11 shrink-0 rounded-full px-4 text-sm font-semibold tabular-nums disabled:opacity-60 ${status?.on ? "bg-accent text-accent-fg" : "border-border border"}`}>
            {toggling ? `${toggling.verb}… ${Math.round((Date.now() - toggling.since) / 1000)}s` : status?.on ? "On" : "Off"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
        </header>
        {(offline || status?.error) && <p role="alert" className="text-danger px-3 pb-2 text-sm">{status?.error ?? (status?.power ? "Servers are off — flip the switch to start them." : "Brain offline — run `npm run up` on the Mac.")}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto px-3">
          {msgs.length === 0 && <p className="text-muted text-sm">Ask for a character, a scene, a theme or the next arc step. Suggested changes arrive as cards you can apply.</p>}
          {msgs.map((m, i) => {
            const p = m.role === "assistant" ? parseReply(m.content) : null;
            return (
              <div key={i} className={m.role === "user" ? "bg-surface-2 ml-8 rounded-lg p-2.5 text-sm whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>
                {p ? p.prose.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1") : m.content}
                {p?.error && <p className="text-danger mt-1 text-xs">{p.error}</p>}
                {p && p.ops.length > 0 && <PatchCard ops={p.ops} onApply={() => onApply(p.ops)} />}
              </div>
            );
          })}
          {busy && <p className="text-muted text-sm">{busy}</p>}
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
      </section>
    </div>
  );
}
