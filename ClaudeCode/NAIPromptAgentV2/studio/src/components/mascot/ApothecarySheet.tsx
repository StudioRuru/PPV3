"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/lib/copilot-prompt";
import type { Expression } from "@/lib/mascot/core";
import { groupBottles, stripVialBlock, type Bottle as BottleRow } from "@/lib/mascot/ui";
import { parseVialBlock, type AppliedVial, type Vial } from "@/lib/mascot/vial";
import { requestJson } from "@/lib/net";
import { Md } from "../ChatScreen";
import { Sheet } from "../Sheet";
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
const pouring = (active: boolean) => (active ? "Pouring… Miyabi is reacting" : "Pouring…");

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
  const inFlight = useRef(false); // double taps land in the same tick, before `busy` renders

  // chat (MiyabiSheet's thread pattern)
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const tidRef = useRef<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const loadList = () => requestJson<VialListing>(VIALS_API).then((r) => { if (r.ok) setList(r.data); else setError(r.error); });
  async function load(id: number) {
    tidRef.current = id;
    const r = await requestJson<{ threads: Thread[] }>("/api/chat/threads");
    if (r.ok && tidRef.current === id) setThread(r.data.threads.find((t) => t.id === id) ?? null);
    const h = await requestJson<{ messages: ChatMsg[] }>(`/api/chat/history?thread=${id}`);
    if (h.ok && tidRef.current === id) setMsgs(h.data.messages.map(withId));
  }
  async function newTalk() {
    const r = await requestJson<{ id: number }>("/api/chat/threads", json({ persona: "aru" }));
    if (r.ok) await load(r.data.id);
  }
  useEffect(() => {
    if (!open) return;
    loadList(); setError(null); setPick(null); setForget(null);
    requestJson<{ threads: Thread[] }>("/api/chat/threads").then((r) => {
      if (!r.ok) return;
      const last = r.data.threads.find((t) => t.persona === "aru");
      if (last) load(last.id); else newTalk();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load/newTalk/loadList only touch state setters
  }, [open]);
  useEffect(() => { if (open && tab === "shop") end.current?.scrollIntoView({ block: "end" }); }, [msgs, open, tab]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !thread) return;
    let id = thread.id;
    const show = (ms: Msg[]) => { if (tidRef.current === id) setMsgs(ms); };
    const history = [...msgs.filter((m) => !m.error), withId({ role: "user", content: text })];
    const reply = withId({ role: "assistant", content: "" });
    setInput(""); show([...history, reply]); setThinking("Aru is stirring…"); setStreaming(true);
    let out = "";
    try {
      const res = await fetch("/api/chat", json({ thread: id, version: thread.updated_at, messages: history.map(({ role, content }) => ({ role, content })), mode: "chat", persona: "aru" }));
      if (res.status === 409) {
        await load(id);
        if (tidRef.current === id) setMsgs((ms) => [...ms, withId({ role: "assistant", content: "⚠️ This talk changed on another device — reloaded. Send again.", error: true })]);
        setThinking(null); setStreaming(false); return;
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
        setThinking(null); show([...history, { ...reply, content: out }]);
      }
      if (/\n\n⚠️ [^\n]*$/.test(out)) show([...history, { ...reply, content: out, error: true }]);
    } catch (e) {
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
          <button type="button" disabled={off} onClick={() => act({ action: "discard", id: g.ids[0] }, "Pouring it away…")} className={`${btn} text-danger w-full`}>
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
      <header className="flex items-center gap-2 px-3 pb-2">
        <span aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">
          A
          <svg viewBox="0 0 12 12" className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-amber-400 p-0.5 text-amber-900">
            <path d="M6 1.5a3 3 0 0 0-3 3v2.2L2 8.5h8L9 6.7V4.5a3 3 0 0 0-3-3zM5 9.5a1 1 0 0 0 2 0z" fill="currentColor" />
          </svg>
        </span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Aru&apos;s Apothecary</h2>
        {tab === "shop" && <button type="button" disabled={streaming} onClick={newTalk} className="border-border text-accent min-h-11 rounded-full border px-3 text-xs font-semibold disabled:opacity-40">New talk</button>}
        <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 shrink-0 rounded-full border">×</button>
      </header>
      <div role="tablist" aria-label="Apothecary" className="border-border grid shrink-0 grid-cols-3 border-b px-3">
        {(["shop", "shelf", "recipes"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setPick(null); setForget(null); }}
            className={`min-h-11 border-b-2 text-sm font-medium ${tab === t ? "border-accent text-fg" : "text-muted border-transparent"}`}>
            {t === "shop" ? "Shop" : t === "shelf" ? `Shelf${list?.bottles.length ? ` (${list.bottles.length})` : ""}` : "Recipes"}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tab} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        {busy && <p role="status" className="text-accent text-sm"><span className="thinking mr-1" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span>{busy}</p>}
        {error && <p role="alert" className="text-danger text-xs">{error}</p>}
        {line && !busy && tab !== "shop" && <p aria-live="polite" className="text-muted text-xs italic">Miyabi: “{line}”</p>}

        {tab === "shop" && (
          <>
            {msgs.length === 0 && <p className="text-muted text-center text-sm">Ask Aru for a potion — she&apos;ll brew one for Miyabi.</p>}
            {msgs.map((m, i) => {
              if (m.role === "user") return <p key={m.cid} className="animate-rise bg-surface-2 ml-8 rounded-lg p-2.5 text-sm whitespace-pre-wrap">{m.content}</p>;
              const done = !streaming || i < msgs.length - 1;
              const v = done && !m.error ? parseVialBlock(m.content) : null;
              const key = `${thread?.id}:${i}`; // history is append-only, so a message keeps its index across reloads
              return (
                <div key={m.cid} className={`animate-rise space-y-1.5 text-sm leading-relaxed ${m.error ? "text-danger" : ""}`}>
                  <Md text={stripVialBlock(m.content)} />
                  {v && "error" in v && <p className="text-danger text-xs">Her recipe didn&apos;t come out right: {v.error}</p>}
                  {v && !("error" in v) && (
                    <VialCard vial={v}>
                      <button type="button" disabled={off || !!bottled[key]}
                        onClick={() => act({ action: "bottle", vial: v }, "Bottling…", () => setBottled((b) => ({ ...b, [key]: true })))}
                        className={`${primary} mt-1 w-full`}>{bottled[key] ? "Bottled ✓" : "Bottle it"}</button>
                    </VialCard>
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

      {tab === "shelf" && pick && <div className="border-border bg-surface max-h-[60%] space-y-2 overflow-y-auto border-t p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{pickPanel()}</div>}
      {/* Hidden when closed or off the Shop tab: a visible [data-composer] moves the floating mascot up. */}
      <form data-composer className={`border-border gap-2 border-t p-3 ${open && tab === "shop" ? "flex" : "hidden"}`} style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ask Aru for a potion…" aria-label="Message Aru"
          className="bg-bg border-border min-w-0 flex-1 resize-none rounded-md border px-2 py-2.5 text-base" />
        <button type="submit" disabled={streaming || !thread || !input.trim()} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
      </form>
    </Sheet>
  );
}
