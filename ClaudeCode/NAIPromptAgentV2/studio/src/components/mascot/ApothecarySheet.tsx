"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/lib/copilot-prompt";
import { emitReact } from "@/lib/mascot/bus";
import type { Expression } from "@/lib/mascot/core";
import { listenPhase, nextPhase, type TalkPhase } from "@/lib/mascot/talk";
import { bottledKey, groupBottles, historyForEdit, historyForRegenerate, singleFlight, stripVialBlock, vialOutcome, type Bottle as BottleRow } from "@/lib/mascot/ui";
import type { AppliedVial, Vial } from "@/lib/mascot/vial";
import { requestJson } from "@/lib/net";
import { Md } from "../ChatScreen";
import { Sheet } from "../Sheet";
import { AutoTextarea } from "../TagInput";
import { PortraitStage } from "./PortraitStage";
import { Bottle, VialCard } from "./VialCard";

export type JarPotions = { id: number; name: string; color: string; active: boolean; vials: AppliedVial[]; doses: number; poison: 0 | 1 | 2 };
export type VialListing = { bottles: BottleRow[]; recipes: (Vial & { id: number; brewed: number })[]; undo: Vial; neutral: Vial; jars: JarPotions[] };
type Say = { expression: Expression; text: string };
type Thread = { id: number; persona: string; updated_at: number };
type Msg = ChatMsg & { cid: string; error?: boolean };
type Tab = "shop" | "shelf" | "recipes";
/** Shelf tab panel: a bottle stack's Drop into…, or the Undo / Neutral vial's jar picker (Neutral confirms per jar). */
type Pick = { kind: "bottle"; key: string } | { kind: "undo" } | { kind: "neutral"; confirm: number | null } | null;

export const VIALS_API = "/api/mascot/vials";
const withId = (m: ChatMsg & { error?: boolean }): Msg => ({ ...m, cid: crypto.randomUUID() });
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const btn = "border-border min-h-11 rounded-md border px-3 text-sm disabled:opacity-40";
const primary = "bg-accent text-accent-fg min-h-11 rounded-md px-3 text-sm font-semibold disabled:opacity-40";
const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";
const BOTTLED = "apothecary.bottled";
/** "Already bottled" markers, kept in localStorage when it works (private mode / blocked storage: this session only). */
function readBottled(): Record<string, true> {
  try { const v = JSON.parse(localStorage.getItem(BOTTLED) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function saveBottled(b: Record<string, true>) {
  try { localStorage.setItem(BOTTLED, JSON.stringify(Object.fromEntries(Object.entries(b).slice(-300)))); } catch { /* storage unavailable */ }
}
const pouring = (active: boolean) => (active ? "Pouring… Miyabi is reacting" : "Pouring…");

/** Thread opens are single-flight: opening the shop twice quickly shares one create instead of making two aru threads. */
const createAru = singleFlight(async () => { const r = await requestJson<{ id: number }>("/api/chat/threads", json({ persona: "aru" })); return r.ok ? r.data.id : null; });
const openAru = singleFlight(async () => {
  const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads");
  if (!r.ok) return null;
  return r.data.threads.find((t) => t.persona === "aru")?.id ?? createAru();
});

/** Aru's shop: chat with her (persona `aru`), bottle her brews, the bottle shelf, the recipe book. */
export function ApothecarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("shop");
  const [list, setList] = useState<VialListing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null); // Miyabi's reaction to the last pour
  const [pick, setPick] = useState<Pick>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [forget, setForget] = useState<number | null>(null);
  const [bottled, setBottled] = useState<Record<string, true>>({});
  useEffect(() => { if (open) setBottled((b) => ({ ...readBottled(), ...b })); }, [open]);
  const markBottled = (key: string) => setBottled((b) => { const next = { ...b, [key]: true as const }; saveBottled(next); return next; });
  const inFlight = useRef(false); // double taps land in the same tick, before `busy` renders

  // chat (her thread, her face: the portrait follows the stream)
  const [phase, setPhase] = useState<TalkPhase>("idle");
  const [focused, setFocused] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const tidRef = useRef<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const loadList = () => requestJson<VialListing>(VIALS_API).then((r) => { if (r.ok) setList(r.data); else setError(r.error); });
  async function load(id: number) {
    tidRef.current = id; setEditing(null);
    const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads");
    if (r.ok && tidRef.current === id) setThread(r.data.threads.find((t) => t.id === id) ?? null);
    const h = await requestJson<{ messages: ChatMsg[] }>(`/api/chat/history?thread=${id}`);
    if (h.ok && tidRef.current === id) setMsgs(h.data.messages.map(withId));
  }
  async function newTalk() {
    const id = await createAru();
    if (id) { setPhase((p) => nextPhase(p, "reset")); await load(id); }
  }
  useEffect(() => {
    if (!open) return;
    loadList(); setError(null); setPick(null); setForget(null);
    openAru().then((id) => { if (id) load(id); });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load/loadList only touch state setters
  }, [open]);
  useEffect(() => { if (!open) { setPhase((p) => nextPhase(p, "reset")); setFocused(false); } }, [open]);
  const setFocus = (f: boolean) => { setFocused(f); setPhase((p) => listenPhase(p, f)); };
  useEffect(() => { if (open && tab === "shop") end.current?.scrollIntoView({ block: "end" }); }, [msgs, open, tab]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !thread) return;
    setInput("");
    await run([...msgs.filter((m) => !m.error), withId({ role: "user", content: text })]);
  }
  /** Retry: Aru's last reply (and its vial card) is dropped and the same history asked again. */
  function regenerate() { const h = historyForRegenerate(msgs); if (h && !streaming) run(h); }
  function saveEdit() {
    if (!editing || streaming) return;
    const h = historyForEdit(msgs, editing.i, editing.text);
    if (h) { setEditing(null); run(h); }
  }

  /** Ask Aru with this history (the server replaces the stored thread with it, so edits and retries stay in step). */
  async function run(history: Msg[]) {
    if (!thread || streaming) return;
    let id = thread.id;
    const show = (ms: Msg[]) => { if (tidRef.current === id) setMsgs(ms); };
    const reply = withId({ role: "assistant", content: "" });
    show([...history, reply]); setThinking("Aru is stirring…"); setStreaming(true);
    const face = (ev: Parameters<typeof nextPhase>[1]) => { if (tidRef.current === id) setPhase((p) => nextPhase(p, ev)); };
    face("send");
    let out = "";
    try {
      const res = await fetch("/api/chat", json({ thread: id, version: thread.updated_at, messages: history.map(({ role, content }) => ({ role, content })), mode: "chat", persona: "aru" }));
      if (res.status === 409) {
        await load(id);
        if (tidRef.current === id) setMsgs((ms) => [...ms, withId({ role: "assistant", content: "⚠️ This talk changed on another device — reloaded. Send again.", error: true })]);
        face("error"); setThinking(null); setStreaming(false); return;
      }
      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body).error ?? body; } catch { /* plain text */ }
        throw new Error(res.status === 401 ? "Session expired — reload the page and sign in again." : msg || `Server error ${res.status}.`);
      }
      const realId = Number(res.headers.get("X-Thread"));
      if (realId && realId !== id) { if (tidRef.current === id) tidRef.current = realId; id = realId; }
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += dec.decode(value, { stream: true });
        setThinking(null); face("firstToken"); show([...history, { ...reply, content: out }]);
      }
      if (/\n\n⚠️ [^\n]*$/.test(out)) { show([...history, { ...reply, content: out, error: true }]); face("error"); } else face("end");
    } catch (e) {
      face("error");
      show([...history, { ...reply, content: `${out}\n\n⚠️ ${(e as Error).message || "Network error — tap send to retry."}`, error: true }]);
    }
    setThinking(null); setStreaming(false);
    if (tidRef.current === id) load(id); // fresh version for the next send
  }

  /** One vials action: controls disabled while it runs; fresh listing on success, inline error + resync on failure. */
  async function act(body: Record<string, unknown>, label: string, done?: () => void): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(label); setError(null);
    const touched = typeof body.jarId === "number" && !!list?.jars.find((j) => j.id === body.jarId)?.active;
    const r = await requestJson<VialListing & { quip?: Say }>(VIALS_API, json(body));
    inFlight.current = false; setBusy(null);
    if (touched) window.dispatchEvent(new Event("mascot:identity")); // a timeout may still have landed server-side
    if (!r.ok) { setError(r.error); loadList(); return false; }
    setList(r.data);
    done?.();
    if (body.action === "drop" && touched) emitReact("miyabi", "vial_drop");
    else if (body.action === "brew" || body.action === "bottle") emitReact("aru", "brewed");
    if (r.data.quip?.text) { setLine(r.data.quip.text); window.dispatchEvent(new CustomEvent("mascot:say", { detail: r.data.quip })); }
    return true;
  }

  const off = !!busy;
  const jars = list?.jars ?? [];
  const groups = groupBottles(list?.bottles ?? []);

  function jarButton(j: JarPotions, onClick: () => void, disabled = false) {
    return (
      <li key={j.id}>
        <button type="button" disabled={off || disabled} onClick={onClick}
          className="border-border flex min-h-11 w-full items-center gap-2 rounded-md border px-2 text-left text-sm disabled:opacity-40">
          <span aria-hidden="true" className="size-4 shrink-0 rounded-full" style={{ background: j.color }} />
          <span className="min-w-0 flex-1 truncate">{j.name}</span>
          {j.active && <span className="bg-accent text-accent-fg rounded-full px-1.5 text-[10px] font-semibold">active</span>}
          <span className="text-faint shrink-0 text-xs">{j.doses ? `${j.doses} dose${j.doses > 1 ? "s" : ""}` : "no potions"}</span>
        </button>
      </li>
    );
  }

  function pickPanel() {
    if (!pick) return null;
    const close = <button type="button" onClick={() => setPick(null)} disabled={off} className="text-muted min-h-11 px-2 text-sm">Close</button>;
    if (pick.kind === "bottle") {
      const g = groups.find((x) => x.name.trim().toLowerCase() === pick.key);
      if (!g) return null;
      return (
        <>
          <div className="flex items-center gap-2"><h3 className="flex-1 truncate text-sm font-semibold">Drop {g.name} into…</h3>{close}</div>
          {!jars.length ? <p className="text-faint text-xs">No jars on the shelf yet.</p> : (
            <ul className="space-y-1">{jars.map((j) => jarButton(j, () => act({ action: "drop", id: g.ids[0], jarId: j.id }, pouring(j.active), () => setPick(null))))}</ul>
          )}
          <button type="button" disabled={off} onClick={() => act({ action: "discard", id: g.ids[0] }, "Pouring it away…", () => { if (g.count === 1) setPick(null); })} className={`${btn} text-danger w-full`}>
            Discard one bottle
          </button>
        </>
      );
    }
    if (pick.kind === "undo") return (
      <>
        <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">Pour the Undo vial into…</h3>{close}</div>
        <p className="text-muted text-xs">Takes back the last dose in that jar.</p>
        <ul className="space-y-1">{jars.map((j) => jarButton(j, () => act({ action: "undo", jarId: j.id }, pouring(j.active), () => setPick(null)), !j.doses))}</ul>
      </>
    );
    const c = jars.find((j) => j.id === pick.confirm);
    return (
      <>
        <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">Pour the Neutral vial into…</h3>{close}</div>
        {c ? (
          <div role="alertdialog" aria-label="Confirm Neutral vial" className="border-danger/40 bg-danger/10 space-y-2 rounded-lg border p-3 text-sm">
            <p>Clear every potion in <b>{c.name}</b>? All {c.doses} dose{c.doses > 1 ? "s" : ""} are taken back.</p>
            <div className="flex gap-2">
              <button type="button" disabled={off} onClick={() => setPick({ kind: "neutral", confirm: null })} className={`${btn} flex-1`}>Cancel</button>
              <button type="button" disabled={off} onClick={() => act({ action: "neutral", jarId: c.id }, pouring(c.active), () => setPick(null))}
                className="bg-danger min-h-11 flex-1 rounded-md px-3 font-semibold text-white disabled:opacity-40">Clear potions</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-muted text-xs">Clears every potion in that jar.</p>
            <ul className="space-y-1">{jars.map((j) => jarButton(j, () => setPick({ kind: "neutral", confirm: j.id }), !j.doses))}</ul>
          </>
        )}
      </>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} label="Aru's Apothecary" closeLabel="Close Aru's Apothecary"
      className="h-[94dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-xl lg:rounded-none lg:border-l">
      {/* Face to face: Aru on the top quarter of the sheet (a strip while typing); tabs, chat and vials scroll below. */}
      <PortraitStage profile="aru" outfit="day" phase={phase} expression="smug" empty={false} className="shrink-0 px-3"
        style={{ height: focused ? "90px" : "23dvh" }} />
      <header className="flex items-center gap-2 px-3 pb-1">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Aru&apos;s Apothecary</h2>
        {tab === "shop" && <button type="button" disabled={streaming} onClick={newTalk} className="border-border text-accent min-h-11 rounded-full border px-3 text-xs font-semibold disabled:opacity-40">New talk</button>}
        <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 shrink-0 rounded-full border">×</button>
      </header>
      <div role="tablist" aria-label="Apothecary" className="border-border grid shrink-0 grid-cols-3 border-b px-3">
        {(["shop", "shelf", "recipes"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setFocus(false); setPick(null); setForget(null); }}
            className={`min-h-11 border-b-2 text-sm font-medium ${tab === t ? "border-accent text-fg" : "text-muted border-transparent"}`}>
            {t === "shop" ? "Shop" : t === "shelf" ? `Shelf${list?.bottles.length ? ` (${list.bottles.length})` : ""}` : "Recipes"}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tab} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        {busy && <p role="status" className="text-accent text-sm"><span className="thinking mr-1" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span>{busy}</p>}
        {error && !(tab === "shelf" && pick) && <p role="alert" className="text-danger text-xs">{error}</p>}
        {line && !busy && tab !== "shop" && <p aria-live="polite" className="text-muted text-xs italic">Miyabi: “{line}”</p>}

        {tab === "shop" && (
          <>
            {msgs.length === 0 && <p className="text-muted text-center text-sm">Ask Aru for a potion — she&apos;ll brew one for Miyabi.</p>}
            {msgs.map((m, i) => {
              if (m.role === "user" && editing?.i === i) return (
                <div key={m.cid} className="space-y-1.5">
                  <AutoTextarea value={editing.text} onChange={(text) => setEditing({ i, text })} />
                  <div className="flex gap-2 text-sm">
                    <button type="button" disabled={streaming || !editing.text.trim()} onClick={saveEdit} className="bg-accent text-accent-fg min-h-11 rounded-md px-3 font-semibold disabled:opacity-40">Resend</button>
                    <button type="button" onClick={() => setEditing(null)} className="min-h-11 px-3">Cancel</button>
                  </div>
                </div>
              );
              if (m.role === "user") return (
                <div key={m.cid} className="animate-rise bg-surface-2 ml-8 rounded-lg p-2.5 text-sm">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {!streaming && <button type="button" onClick={() => setEditing({ i, text: m.content })} aria-label={`Edit message ${i + 1}`} className="text-faint min-h-11 text-xs">Edit</button>}
                </div>
              );
              const done = !streaming || i < msgs.length - 1;
              const o = m.error ? null : vialOutcome(m.content, done);
              const v = o?.kind === "vial" ? o.vial : null;
              const key = v ? bottledKey(thread?.id ?? 0, v) : "";
              return (
                <div key={m.cid} className={`animate-rise space-y-1.5 text-sm leading-relaxed ${m.error ? "text-danger" : ""}`}>
                  <Md text={stripVialBlock(m.content)} />
                  {o?.kind === "fumbled" && <p className="text-muted text-xs italic">Aru fumbled the recipe — ask again</p>}
                  {v && (
                    <VialCard vial={v}>
                      <button type="button" disabled={off || !!bottled[key]}
                        onClick={() => act({ action: "bottle", vial: v }, "Bottling…", () => markBottled(key))}
                        className={`${primary} mt-1 w-full`}>{bottled[key] ? "Bottled ✓" : "Bottle it"}</button>
                    </VialCard>
                  )}
                  {i === msgs.length - 1 && !streaming && m.content && i > 0 && (
                    <button type="button" onClick={regenerate} aria-label="Regenerate Aru's reply" className="text-faint min-h-11 text-xs">Regenerate</button>
                  )}
                </div>
              );
            })}
            {thinking && <p role="status" className="text-muted animate-rise text-sm">{thinking}</p>}
            <div ref={end} />
          </>
        )}

        {tab === "shelf" && (
          <>
            <h3 className={h3}>Always on hand</h3>
            {list && (
              <div className="grid grid-cols-2 gap-2">
                {([["undo", list.undo], ["neutral", list.neutral]] as const).map(([k, v]) => (
                  <button key={k} type="button" disabled={off} aria-pressed={pick?.kind === k} onClick={() => setPick(k === "undo" ? { kind: "undo" } : { kind: "neutral", confirm: null })}
                    className={`border-border flex min-h-11 items-center gap-2 rounded-lg border p-2 text-left ${pick?.kind === k ? "bg-accent-soft" : ""}`}>
                    <Bottle color={v.color} className="h-10 w-8" />
                    <span className="min-w-0"><span className="block text-sm font-semibold">{v.name}</span><span className="text-muted block text-[11px]">{v.effect}</span></span>
                  </button>
                ))}
              </div>
            )}
            <h3 className={h3}>Bottles</h3>
            {!list ? <p className="text-faint text-xs">Loading…</p> : !groups.length ? <p className="text-faint text-xs">No bottles yet — ask Aru to brew something, or brew again from the recipe book.</p> : (
              <ul className="space-y-2">
                {groups.map((g) => {
                  const key = g.name.trim().toLowerCase();
                  return (
                    <li key={key}>
                      <VialCard vial={g} badge={g.count > 1 ? `×${g.count}` : undefined}>
                        <button type="button" disabled={off} aria-pressed={pick?.kind === "bottle" && pick.key === key} onClick={() => setPick({ kind: "bottle", key })}
                          className={`${btn} mt-1 w-full ${pick?.kind === "bottle" && pick.key === key ? "bg-accent-soft" : ""}`}>Drop into… / Discard</button>
                      </VialCard>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {tab === "recipes" && (
          !list ? <p className="text-faint text-xs">Loading…</p> : !list.recipes.length ? <p className="text-faint text-xs">No recipes yet — every bottle you keep from Aru is written down here.</p> : (
            <ul className="space-y-2">
              {list.recipes.map((r) => {
                const n = counts[r.id] ?? 1, setN = (x: number) => setCounts({ ...counts, [r.id]: Math.max(1, Math.min(5, x)) });
                return (
                  <li key={r.id}>
                    <VialCard vial={r} badge={r.brewed ? `brewed ${r.brewed}×` : undefined}>
                      {forget === r.id ? (
                        <div role="alertdialog" aria-label="Confirm forget recipe" className="border-danger/40 bg-danger/10 mt-1 space-y-2 rounded-lg border p-2 text-sm">
                          <p>Tear <b>{r.name}</b> out of the recipe book? Bottles you already have stay.</p>
                          <div className="flex gap-2">
                            <button type="button" disabled={off} onClick={() => setForget(null)} className={`${btn} flex-1`}>Cancel</button>
                            <button type="button" disabled={off} onClick={() => act({ action: "forget", recipeId: r.id }, "Tearing out the page…", () => setForget(null))}
                              className="bg-danger min-h-11 flex-1 rounded-md px-3 font-semibold text-white disabled:opacity-40">Forget</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <div className="border-border flex items-center rounded-md border" role="group" aria-label={`How many ${r.name}`}>
                            <button type="button" aria-label="One fewer" disabled={off || n <= 1} onClick={() => setN(n - 1)} className="size-11 disabled:opacity-40">−</button>
                            <span aria-live="polite" className="w-6 text-center text-sm tabular-nums">{n}</span>
                            <button type="button" aria-label="One more" disabled={off || n >= 5} onClick={() => setN(n + 1)} className="size-11 disabled:opacity-40">+</button>
                          </div>
                          <button type="button" disabled={off} onClick={() => act({ action: "brew", recipeId: r.id, count: n }, "Brewing…")} className={`${primary} flex-1`}>Brew again ×{n}</button>
                          <button type="button" disabled={off} onClick={() => setForget(r.id)} className={`${btn} text-danger`}>Forget</button>
                        </div>
                      )}
                    </VialCard>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>

      {tab === "shelf" && pick && <div className="border-border bg-surface max-h-[60%] space-y-2 overflow-y-auto border-t p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{error && <p role="alert" className="text-danger text-xs">{error}</p>}{pickPanel()}</div>}
      {/* Hidden when closed or off the Shop tab: a visible [data-composer] moves the floating mascot up. */}
      <form data-composer className={`border-border gap-2 border-t p-3 ${open && tab === "shop" ? "flex" : "hidden"}`} style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} rows={1} placeholder="Ask Aru for a potion…" aria-label="Message Aru"
          className="bg-bg border-border min-w-0 flex-1 resize-none rounded-md border px-2 py-2.5 text-base" />
        <button type="submit" disabled={streaming || !thread || !input.trim()} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
      </form>
    </Sheet>
  );
}
