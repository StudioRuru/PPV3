"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMsg, Mode } from "@/lib/copilot-prompt";
import { inline, mdBlocks } from "@/lib/md";
import { requestJson } from "@/lib/net";
import { learnTags, parseReply, type Op } from "@/lib/patch";
import { PERSONAS, type Modifiers, type PersonaId } from "@/lib/persona";
import type { PromptState } from "@/lib/prompt";
import { PatchCard } from "./PatchCard";
import { Sheet } from "./Sheet";
import { AutoTextarea } from "./TagInput";
import { Trash } from "./icons";

type Status = { on: boolean; brain: boolean; caption: boolean; tipo: boolean; power?: boolean; error?: string };
type Thread = { id: number; title: string; persona: PersonaId; mods: Modifiers; updated_at: number };
/** cid: client-side id (stable keys for cards/ratings); error: shown locally, never sent or stored. */
type Msg = ChatMsg & { image?: string | null; cid: string; error?: boolean };
const withId = (m: ChatMsg & { image?: string | null; cid?: string; error?: boolean }): Msg => ({ ...m, cid: m.cid ?? crypto.randomUUID() });
const wire = (ms: Msg[]) => ms.filter((m) => !m.error).map(({ role, content, image }) => ({ role, content, image: image ?? null }));
type Taste = { profile: { favoured: string[]; avoided: string[]; notes: string[] }; pinned: { id: number; text: string }[]; drift: Record<PersonaId, number> };
export type ChatSeed = { text: string; image?: File; tags?: string } | null;
type Kind = "arc" | "outfit" | "theme" | "cluster";
type ClosetItem = { kind: Kind; dir: string; slug: string; name: string };

const MODES: [Mode, string][] = [["character", "Create character"], ["scene", "Build scene"], ["theme", "Theme"], ["arc", "Arc step"], ["cluster", "Cluster these tags"]];
// Which Closet items each mode can start from (the second chip row).
const PRESET_KIND: Partial<Record<Mode, Kind>> = { scene: "arc", arc: "arc", theme: "theme", cluster: "cluster", character: "outfit" };
const PRESET_ACTIONS = ["Modify", "Add on to", "Combine with my prompt", "Mutate / escalate", "Update", "Remove parts of"];
const EYES = "\n\n— eyes report —\n"; // separates what the user typed from the image analysis in a stored message
const LIKE_Q = ["Great tags", "Loved the idea", "Perfect intensity", "Funny"], DISLIKE_Q = ["Wrong tags", "Too tame", "Too much", "Wrong character", "Missed the image detail"];
const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Runs({ text }: { text: string }) {
  return <>{inline(text).map((r, i) => (r.b ? <strong key={i} className="font-semibold">{r.t}</strong> : r.i ? <em key={i}>{r.t}</em> : r.t))}</>;
}
function Md({ text }: { text: string }) {
  return <>{mdBlocks(text).map((b, i) =>
    b.kind === "h" ? <h3 key={i} className="text-accent pt-1 text-xs font-semibold tracking-wide uppercase"><Runs text={b.text} /></h3>
    : b.kind === "li" ? <p key={i} className="flex gap-2 pl-1"><span aria-hidden="true" className="text-muted">•</span><span><Runs text={b.text} /></span></p>
    : <p key={i} className="whitespace-pre-wrap"><Runs text={b.text} /></p>)}</>;
}

export function ChatScreen({ active, state, onApply, seed }: { active: boolean; state: PromptState; onApply: (ops: Op[]) => void; seed: ChatSeed }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [toggling, setToggling] = useState<{ verb: string; since: number } | null>(null);
  const [, tick] = useState(0);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tid, setTid] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const [feedback, setFeedback] = useState<{ cid: string; kind: "like" | "dislike"; note: string } | null>(null);
  const [rated, setRated] = useState<Record<string, "like" | "dislike">>({});
  const [drift, setDriftLocal] = useState<number | null>(null); // slider value while dragging; committed on release
  const [confirmReset, setConfirmReset] = useState(false);
  const [persona, setPersonaOpen] = useState(false);
  const [taste, setTaste] = useState<Taste | null>(null);
  const [pinText, setPinText] = useState("");
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [preset, setPreset] = useState<ClosetItem | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const tidRef = useRef(tid);
  tidRef.current = tid;
  const thread = threads.find((t) => t.id === tid) ?? null;

  const loadThreads = useCallback(async (pick?: number) => {
    const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads");
    if (!r.ok) return;
    setThreads(r.data.threads);
    const ok = (id: number | null | undefined) => id != null && r.data.threads.some((t) => t.id === id);
    setTid((cur) => (ok(pick) ? pick! : ok(cur) ? cur : r.data.threads[0]?.id ?? null));
  }, []);
  useEffect(() => {
    if (!active) return;
    requestJson<Status>("/api/copilot").then((r) => r.ok && setStatus(r.data));
    requestJson<{ items: ClosetItem[] }>("/api/closet").then((r) => r.ok && setCloset(r.data.items));
    loadThreads();
    loadTaste();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadTaste is stable enough (no deps)
  }, [active, loadThreads]);
  useEffect(() => {
    if (tid === null) { setMsgs([]); return; }
    requestJson<{ messages: Msg[] }>(`/api/chat/history?thread=${tid}`).then((r) => r.ok && tidRef.current === tid && setMsgs(r.data.messages.map(withId)));
    setRated({}); setEditing(null); setFeedback(null);
  }, [tid]);
  useEffect(() => { if (active) end.current?.scrollIntoView({ block: "end" }); }, [msgs, active]);
  useEffect(() => {
    if (!toggling) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [toggling]);

  async function toggle() {
    const on = !status?.on;
    setToggling({ verb: on ? (status?.power ? "Starting" : "Loading") : "Stopping", since: Date.now() });
    const r = await requestJson<Status>("/api/copilot", { method: "POST", ...json({ on }) });
    const s = r.ok ? r.data : await requestJson<Status>("/api/copilot").then((g) => (g.ok ? g.data : status));
    setToggling(null);
    setStatus({ ...(s ?? { on: false, brain: false, caption: false, tipo: false }), error: r.ok ? undefined : r.error });
  }

  async function newThread() {
    const r = await requestJson<{ id: number; threads: Thread[] }>("/api/chat/threads", { method: "POST", ...json({ persona: thread?.persona ?? "neutral" }) });
    if (r.ok) { setThreads(r.data.threads); setTid(r.data.id); }
  }
  async function deleteThread(id: number) {
    const r = await requestJson<{ threads: Thread[] }>(`/api/chat/threads?id=${id}`, { method: "DELETE" });
    setConfirmDel(null);
    if (r.ok) { setThreads(r.data.threads); setTid(r.data.threads[0]?.id ?? null); }
  }
  async function patchThread(patch: Partial<Pick<Thread, "persona" | "mods" | "title">>) {
    if (!thread) return;
    const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads", { method: "PATCH", ...json({ id: thread.id, ...patch }) });
    if (r.ok) setThreads(r.data.threads);
  }
  async function loadTaste() { const r = await requestJson<Taste>("/api/taste"); if (r.ok) setTaste(r.data); }
  async function tasteAction(body: object) { const r = await requestJson<Taste>("/api/taste", { method: "POST", ...json(body) }); if (r.ok) setTaste(r.data); }

  /** Send `history` (ending with the user's message) to thread `id` and stream the reply into place. */
  async function run(history: Msg[], m: Mode = mode, captured: number | null = tid) {
    let id = captured;
    if (id === null) {
      const r = await requestJson<{ id: number; threads: Thread[] }>("/api/chat/threads", { method: "POST", ...json({ persona: "neutral" }) });
      if (!r.ok) return;
      id = r.data.id; setThreads(r.data.threads); tidRef.current = id; setTid(id);
    }
    const version = threads.find((t) => t.id === id)?.updated_at;
    // Only paint into the view if the user is still looking at this thread.
    const show = (ms: Msg[]) => { if (tidRef.current === id) setMsgs(ms); };
    const reply = withId({ role: "assistant", content: "" });
    show([...history, reply]);
    setBusy("Thinking…");
    let text = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", ...json({ thread: id, version, messages: wire(history), state, mode: m }) });
      if (res.status === 409) {
        const h = await requestJson<{ messages: Msg[] }>(`/api/chat/history?thread=${id}`);
        if (h.ok) show([...h.data.messages.map(withId), withId({ role: "assistant", content: "⚠️ This chat changed on another device — reloaded. Send again.", error: true })]);
        setBusy(null); loadThreads(id); return;
      }
      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body).error ?? body; } catch { /* plain text */ }
        throw new Error(res.status === 401 ? "Session expired — reload the page and sign in again." : msg || `Server error ${res.status}.`);
      }
      const realId = Number(res.headers.get("X-Thread"));
      if (realId && realId !== id) { id = realId; tidRef.current = realId; setTid(realId); }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        setBusy(null);
        show([...history, { ...reply, content: text }]);
      }
      // A failure reported inside the stream: keep it on screen, but it's not part of the conversation.
      if (/\n\n⚠️ [^\n]*$/.test(text)) show([...history, { ...reply, content: text, error: true }]);
    } catch (e) {
      show([...history, { ...reply, content: `${text}\n\n⚠️ ${(e as Error).message || "Network error — tap send to retry."}`, error: true }]);
    }
    setBusy(null); setMode("chat"); setPreset(null);
    loadThreads(id); // version, title and order update after a reply
  }

  async function send() {
    const text = input.trim();
    if ((!text && !file) || busy) return;
    // Captured now: the attach below can take a minute, and the user may look at another thread meanwhile.
    const id = tid, base = msgsRef.current;
    let content = text, image: string | null = null;
    if (preset) {
      const r = await requestJson<{ item: { fields: { path: (string | number)[]; label: string; value: string | string[] }[] } }>(`/api/closet/${preset.dir}/${preset.slug}`);
      if (r.ok) content += `\n\nPreset (${preset.kind}) "${preset.name}":\n${r.data.item.fields.map((f) => `${f.label}: ${Array.isArray(f.value) ? f.value.join(", ") : f.value}`).filter((l) => !/: $/.test(l)).join("\n")}`;
    }
    if (file) {
      setBusy("Looking at the image…");
      const fd = new FormData(); fd.append("file", file); fd.append("focus", text);
      const r = await requestJson<{ image: string; tags: string; caption: string; notes: string[] }>("/api/chat/attach", { method: "POST", body: fd });
      setBusy(null);
      if (!r.ok) { if (tidRef.current === id) setMsgs([...base, withId({ role: "assistant", content: `⚠️ ${r.error}`, error: true })]); return; }
      image = r.data.image;
      content = `${content || "What's in this image? Turn it into tags."}${EYES}${r.data.tags ? `Tags seen: ${r.data.tags}\n` : ""}${r.data.caption ? `Detailed look${text ? ` (focus: ${text})` : ""}:\n${r.data.caption}` : ""}${r.data.notes.length ? `\n(${r.data.notes.join("; ")})` : ""}`;
    }
    setInput(""); setFile(null);
    await run([...base, withId({ role: "user", content, image })], mode, id);
  }

  async function saveEdit() {
    if (!editing || tid === null) return;
    const id = tid, base = msgsRef.current;
    const m = base[editing.i];
    if (m.role === "user") {
      // Editing your own message resends from there: everything after it is replaced.
      if (!editing.text.trim() && !m.image) return;
      const keep = m.content.includes(EYES) ? editing.text + m.content.slice(m.content.indexOf(EYES)) : editing.text;
      setEditing(null);
      await run([...base.slice(0, editing.i), withId({ ...m, cid: undefined, content: keep })], mode, id);
    } else {
      // Correcting a reply re-shapes its change card and teaches the next turn; saved without asking the brain.
      const next = base.map((x, j) => (j === editing.i ? { ...x, content: editing.text, error: false } : x));
      setMsgs(next); setEditing(null);
      const r = await requestJson("/api/chat/history", { method: "PUT", ...json({ thread: id, version: thread?.updated_at, messages: wire(next) }) });
      if (!r.ok) { const h = await requestJson<{ messages: Msg[] }>(`/api/chat/history?thread=${id}`); if (h.ok) setMsgs(h.data.messages.map(withId)); }
      loadThreads(id);
    }
  }

  // One rating per reply; the feedback question records it (with its note) once.
  function rate(cid: string, kind: "like" | "dislike") { if (rated[cid]) return; setRated({ ...rated, [cid]: kind }); setFeedback({ cid, kind, note: "" }); }
  async function sendFeedback(note: string) {
    if (!feedback) return;
    const p = parseReply(msgsRef.current.find((x) => x.cid === feedback.cid)?.content ?? "");
    await requestJson("/api/taste", { method: "POST", ...json({ event: { kind: feedback.kind, tags: learnTags(p.ops), note, persona: thread?.persona ?? "neutral" } }) });
    setFeedback(null); loadTaste();
  }
  async function applyOps(picked: Op[]) {
    onApply(picked);
    requestJson("/api/taste", { method: "POST", ...json({ event: { kind: "apply", tags: learnTags(picked), note: "", persona: thread?.persona ?? "neutral" } }) });
  }

  // Seeds from the Tagger ("Make this a scene"): attach the image and ask for a scene.
  useEffect(() => {
    if (!seed) return;
    setMode("scene"); setInput(seed.text);
    if (seed.image) setFile(seed.image);
  }, [seed]);

  const offline = status && !status.brain;
  const thumbOn = toggling ? toggling.verb !== "Stopping" : !!status?.on;
  const dots: [string, boolean, boolean?][] = status ? [["brain", status.on, status.brain], ["eyes", status.caption], ["tipo", status.tipo]] : [];
  const pName = PERSONAS.find((p) => p.id === (thread?.persona ?? "neutral"))!.name;
  const mods = thread ? (Object.entries(thread.mods) as [keyof Modifiers, boolean][]).filter(([, v]) => v).map(([k]) => k) : [];
  const presetKind = PRESET_KIND[mode];
  const lastAssistant = msgs.map((m) => m.role).lastIndexOf("assistant");

  return (
    <section aria-label="Chat" className="flex min-h-[calc(100dvh-9rem)] flex-col gap-2">
      <header className="flex items-center gap-2">
        <h1 className="text-[15px] font-semibold tracking-wide">Chat</h1>
        <span className="text-muted flex min-w-0 flex-1 gap-2 overflow-hidden font-mono text-[11px]">
          {status ? dots.map(([name, up, half], i) => (
            <span key={name} className="flex items-center gap-1 whitespace-nowrap">
              <i key={`${up}${half}`} aria-hidden="true" style={toggling ? { animationDelay: `${i * 180}ms` } : undefined}
                className={`size-1.5 rounded-full ${up ? "bg-ok" : half ? "bg-warn" : "bg-border"} ${toggling ? "dot-breathe" : "dot-settle"}`} />
              {name}<span className="sr-only">{up ? " up" : half ? " idle" : " down"}</span>
            </span>
          )) : "…"}
        </span>
        <button type="button" role="switch" aria-checked={!!status?.on} disabled={!!toggling || (!!offline && !status?.power)} onClick={toggle}
          className={`flex h-10 shrink-0 items-center gap-2 rounded-full border pr-3 pl-1.5 text-sm font-semibold tabular-nums disabled:opacity-60 ${status?.on && !toggling ? "border-accent/60" : "border-border"}`}>
          <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${thumbOn ? "bg-accent" : "bg-surface-2"}`}>
            <span className={`bg-fg absolute top-1 left-1 size-5 rounded-full shadow transition-[translate] duration-300 ${thumbOn ? "translate-x-5" : ""} ${toggling ? "dot-breathe" : ""}`} />
          </span>
          {toggling ? `${Math.round((Date.now() - toggling.since) / 1000)}s` : status?.on ? "On" : "Off"}
        </button>
      </header>
      {(offline || status?.error) && <p role="alert" className="text-danger text-sm">{status?.error ?? (status?.power ? "Servers are off — flip the switch to start them." : "Brain offline — run `npm run up` on the Mac.")}</p>}

      {/* Threads */}
      <div data-noswipe className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1">
        {threads.map((t) => (
          <span key={t.id} className={`flex h-9 shrink-0 items-center rounded-full border text-xs ${t.id === tid ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-muted"}`}>
            <button type="button" disabled={!!busy} onClick={() => setTid(t.id)} className="max-w-[10rem] truncate pr-1 pl-3 disabled:opacity-60">{t.title}</button>
            <button type="button" disabled={!!busy} aria-label={`Delete chat ${t.title}`} onClick={() => setConfirmDel(t.id)} className="grid size-8 place-items-center opacity-70 disabled:opacity-30">×</button>
          </span>
        ))}
        <button type="button" disabled={!!busy} onClick={newThread} className="border-border text-accent h-9 shrink-0 rounded-full border px-3 text-xs font-semibold disabled:opacity-40">+ New</button>
      </div>
      {confirmDel !== null && (
        <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-lg border p-2 text-sm">
          <span className="flex-1">Delete &ldquo;{threads.find((t) => t.id === confirmDel)?.title}&rdquo; and its images?</span>
          <button type="button" onClick={() => setConfirmDel(null)} className="px-2 py-1.5">Cancel</button>
          <button type="button" onClick={() => deleteThread(confirmDel)} className="bg-danger rounded-md px-3 py-1.5 font-semibold text-white">Delete</button>
        </div>
      )}

      {/* Persona */}
      <button type="button" onClick={() => { setPersonaOpen(true); loadTaste(); }} disabled={!thread}
        className="border-border bg-surface flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs disabled:opacity-50">
        <span aria-hidden="true" className="bg-accent size-2 rounded-full" />
        <span className="font-semibold">{pName}</span>
        {mods.length > 0 && <span className="text-muted">· {mods.join(" · ")}</span>}
        <span className="text-faint font-mono">· {taste?.drift[thread?.persona ?? "neutral"] ?? "…"}</span>
      </button>

      {/* Messages */}
      <div className="flex-1 space-y-3">
        {msgs.length === 0 && <p className="text-muted text-sm">Ask for a character, a scene, a theme or the next arc step — or attach an image and ask about a detail. Suggested changes arrive as cards you can pick from and apply.</p>}
        {msgs.map((m, i) => {
          const p = m.role === "assistant" ? parseReply(m.content) : null;
          const said = m.content.includes(EYES) ? m.content.slice(0, m.content.indexOf(EYES)) : m.content;
          const eyes = m.content.includes(EYES) ? m.content.slice(m.content.indexOf(EYES) + EYES.length) : "";
          if (editing?.i === i) return (
            <div key={m.cid} className="space-y-1.5">
              <AutoTextarea value={editing.text} onChange={(text) => setEditing({ i, text })} />
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={saveEdit} className="bg-accent text-accent-fg rounded-md px-3 py-1.5 font-semibold">{m.role === "user" ? "Resend" : "Save"}</button>
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5">Cancel</button>
              </div>
            </div>
          );
          return m.role === "user" ? (
            <div key={m.cid} className="animate-rise bg-surface-2 ml-8 space-y-1.5 rounded-lg p-2.5 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.image && <img src={`/api/chat/image/${m.image}`} alt="Attached" className="max-h-48 rounded-md" />}
              <p className="whitespace-pre-wrap">{said}</p>
              {eyes && <details className="text-muted text-xs"><summary className="cursor-pointer">eyes report</summary><p className="mt-1 whitespace-pre-wrap">{eyes}</p></details>}
              {!busy && <button type="button" onClick={() => setEditing({ i, text: said })} className="text-faint text-xs">Edit</button>}
            </div>
          ) : (
            <div key={m.cid} className={`animate-rise space-y-1.5 text-sm leading-relaxed ${m.error ? "text-danger" : ""}`}>
              <Md text={p!.prose} />
              {p!.error && <p className="text-danger mt-1 text-xs">{p!.error}</p>}
              {p!.ops.length > 0 && <PatchCard ops={p!.ops} onApply={applyOps} />}
              {!busy && m.content && !m.error && (
                <div className="text-faint flex items-center gap-3 text-xs">
                  <button type="button" aria-label="Like reply" aria-pressed={rated[m.cid] === "like"} disabled={!!rated[m.cid]} onClick={() => rate(m.cid, "like")} className={rated[m.cid] === "like" ? "text-ok" : ""}>👍</button>
                  <button type="button" aria-label="Dislike reply" aria-pressed={rated[m.cid] === "dislike"} disabled={!!rated[m.cid]} onClick={() => rate(m.cid, "dislike")} className={rated[m.cid] === "dislike" ? "text-danger" : ""}>👎</button>
                  {i === lastAssistant && <button type="button" onClick={() => run(msgs.slice(0, i))}>Regenerate</button>}
                  <button type="button" onClick={() => setEditing({ i, text: m.content })}>Edit</button>
                </div>
              )}
              {feedback?.cid === m.cid && (
                <div className="bg-surface border-border animate-rise space-y-2 rounded-lg border p-2.5">
                  <p className="text-xs">{feedback.kind === "like" ? "Nice — what did you like?" : "What was off?"} <span className="text-faint">(it learns from this)</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {(feedback.kind === "like" ? LIKE_Q : DISLIKE_Q).map((q) => (
                      <button key={q} type="button" onClick={() => sendFeedback(q)} className="border-border h-8 rounded-full border px-3 text-xs">{q}</button>
                    ))}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendFeedback(feedback.note); }}>
                    <input value={feedback.note} onChange={(e) => setFeedback({ ...feedback, note: e.target.value })} placeholder="or say it in your words…" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-1.5 text-base" />
                    <button type="submit" className="text-accent px-2 text-sm font-semibold">Send</button>
                  </form>
                </div>
              )}
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

      {/* Composer: sits above the tab bar */}
      <div className="bg-bg/95 border-border sticky z-10 -mx-4 space-y-2 border-t px-4 pt-2 pb-2 backdrop-blur" style={{ bottom: "calc(env(safe-area-inset-bottom) + 3.5rem)" }}>
        <div data-noswipe className="flex gap-1.5 overflow-x-auto">
          {MODES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(mode === k ? "chat" : k); setPreset(null); }}
              className={`h-8 shrink-0 rounded-full px-3 text-xs ${mode === k ? "bg-accent text-accent-fg" : "border-border border"}`}>{label}</button>
          ))}
        </div>
        {presetKind && closet.some((c) => c.kind === presetKind) && (
          <div data-noswipe className="flex gap-1.5 overflow-x-auto">
            <span className="text-faint shrink-0 self-center text-[11px]">from:</span>
            {closet.filter((c) => c.kind === presetKind).map((c) => (
              <button key={c.slug} type="button" aria-pressed={preset?.slug === c.slug} onClick={() => setPreset(preset?.slug === c.slug ? null : c)}
                className={`h-8 shrink-0 rounded-full border px-3 text-xs ${preset?.slug === c.slug ? "border-accent text-accent" : "border-border text-muted"}`}>{c.name}</button>
            ))}
          </div>
        )}
        {preset && (
          <div data-noswipe className="flex gap-1.5 overflow-x-auto">
            {PRESET_ACTIONS.map((a) => (
              <button key={a} type="button" onClick={() => setInput(`${a} "${preset.name}": `)} className="border-cyan/50 text-cyan h-8 shrink-0 rounded-full border border-dashed px-3 text-xs">{a}</button>
            ))}
          </div>
        )}
        {file && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted truncate">📎 {file.name} — what you type below is the focus</span>
            <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="text-faint"><Trash /></button>
          </div>
        )}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="border-border text-muted grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border">
            <span aria-hidden="true">📎</span><input type="file" accept="image/*" aria-label="Attach an image" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
          </label>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            placeholder={!status?.on ? "Turn the co-pilot on to chat" : file ? "What should it look at? (e.g. how is the armor broken)" : "Describe what you want…"}
            disabled={!status?.on} className="bg-bg border-border min-w-0 flex-1 resize-none rounded-md border px-2 py-2.5 text-base" />
          <button type="submit" disabled={!status?.on || !!busy || (!input.trim() && !file)} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
        </form>
      </div>

      {/* Persona sheet */}
      <Sheet open={persona} onClose={() => setPersonaOpen(false)} label="Personality" closeLabel="Close personality"
        className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="flex-1 text-base font-semibold">Personality</h2>
          <button type="button" onClick={() => setPersonaOpen(false)} aria-label="Close" className="border-border h-11 w-11 rounded-full border">×</button>
        </header>
        {thread && (
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
            <div role="radiogroup" aria-label="Personality" className="grid gap-2">
              {PERSONAS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={thread.persona === p.id} onClick={() => patchThread({ persona: p.id })}
                  className={`rounded-lg border p-3 text-left ${thread.persona === p.id ? "border-accent bg-accent-soft" : "border-border"}`}>
                  <span className="block text-sm font-semibold">{p.name}</span><span className="text-muted text-xs">{p.blurb}</span>
                </button>
              ))}
            </div>
            <section>
              <h3 className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">Attitude</h3>
              <div className="flex gap-2">
                {(["bratty", "tease", "flirt"] as (keyof Modifiers)[]).map((k) => (
                  <button key={k} type="button" aria-pressed={!!thread.mods[k]} onClick={() => patchThread({ mods: { ...thread.mods, [k]: !thread.mods[k] } })}
                    className={`h-10 flex-1 rounded-full border text-sm capitalize ${thread.mods[k] ? "bg-accent text-accent-fg border-transparent font-semibold" : "border-border"}`}>{k}</button>
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-muted mb-1 text-xs font-medium tracking-wide uppercase">Boldness (learned)</h3>
              {/* Local while dragging; saved once on release (no request per pixel). */}
              <input type="range" min={0} max={100} value={drift ?? taste?.drift[thread.persona] ?? 0} aria-label="Boldness"
                onChange={(e) => setDriftLocal(Number(e.target.value))}
                onPointerUp={() => { if (drift !== null) { tasteAction({ drift: { persona: thread.persona, value: drift } }); setDriftLocal(null); } }}
                onKeyUp={() => { if (drift !== null) { tasteAction({ drift: { persona: thread.persona, value: drift } }); setDriftLocal(null); } }}
                className="accent-accent h-9 w-full" />
              <p className="text-faint text-xs">Rises as you like and apply its ideas, drops on 👎. {drift ?? taste?.drift[thread.persona] ?? 0}/100.</p>
            </section>
            <section className="space-y-2">
              <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Always follow</h3>
              {taste?.pinned.map((p) => (
                <p key={p.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{p.text}</span>
                  <button type="button" aria-label="Unpin" onClick={() => tasteAction({ unpin: p.id })} className="text-faint"><Trash /></button></p>
              ))}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pinText.trim()) { tasteAction({ pin: pinText }); setPinText(""); } }}>
                <input value={pinText} onChange={(e) => setPinText(e.target.value)} placeholder='e.g. "prefer torn clothing over full nudity"' className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
                <button type="submit" className="text-accent px-2 text-sm font-semibold">Pin</button>
              </form>
            </section>
            <section className="text-xs">
              <h3 className="text-muted mb-1 font-medium tracking-wide uppercase">It has learned</h3>
              {taste?.profile.favoured.length ? <p><span className="text-ok">likes</span> {taste.profile.favoured.slice(0, 15).join(", ")}</p> : null}
              {taste?.profile.avoided.length ? <p><span className="text-danger">avoids</span> {taste.profile.avoided.slice(0, 10).join(", ")}</p> : null}
              {taste?.profile.notes.length ? <p className="text-muted">last note: “{taste.profile.notes[0]}”</p> : null}
              {!taste?.profile.favoured.length && !taste?.profile.avoided.length && !taste?.profile.notes.length && <p className="text-faint">Nothing yet — like, dislike and apply to teach it.</p>}
              {confirmReset ? (
                <span className="mt-2 flex items-center gap-2">Forget all likes, dislikes, notes and boldness?
                  <button type="button" onClick={() => setConfirmReset(false)} className="px-2 py-1">Cancel</button>
                  <button type="button" onClick={() => { tasteAction({ reset: true }); setConfirmReset(false); }} className="bg-danger rounded px-2 py-1 font-semibold text-white">Forget</button>
                </span>
              ) : <button type="button" onClick={() => setConfirmReset(true)} className="text-danger mt-2">Forget what it learned</button>}
            </section>
          </div>
        )}
      </Sheet>
    </section>
  );
}
