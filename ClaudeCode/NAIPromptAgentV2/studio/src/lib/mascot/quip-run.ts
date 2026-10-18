// Quip orchestration with injected deps (db/llm wiring lives in quip.ts) so it can be unit-tested.
import { cannedLine, parseQuip, type Expression, type MascotEvent } from "./core";
import type { Identity } from "./identity";
import { quipPrompt } from "./prompt";
import { DATA_RECEIVED, emptyLines } from "./slime";
import { factsPrompt, parseFacts, type MascotStore } from "./store";

export type QuipDeps = {
  /** Heavy model paused the servers or is replying (HeavyGate state "heavy" or busy). */
  heavyInUse: () => boolean;
  model: () => string;
  installed: () => Promise<string[]>;
  context: () => { identity: Identity; taste: string; story: string };
  /** Owner ignored her: nudge the active slime's sliders (no-op when Empty). */
  drift: (event: "idle") => void;
  store: Pick<MascotStore, "log" | "recent" | "facts" | "needsRefresh" | "setFacts" | "markRefreshed">;
  /** One full reply; no timeout (the runner adds it). */
  ask: (system: string, user: string, model: string, options: Record<string, unknown>) => Promise<string>;
  timeoutMs?: number;
  /** Identity marker (active slime + switch count): a facts refresh is dropped if it changed meanwhile. */
  generation?: () => unknown;
  /** The heavy gate: rp_spy while it's paused ("heavy") and idle answers on `heavyModel` inside it. */
  gate?: { readonly state: "light" | "heavy"; readonly busy: boolean; run<T>(fn: () => Promise<T>): Promise<T> };
  heavyModel?: () => string;
  /** Chat expression keys the model may pick (defaults to the legacy list). */
  keys?: () => string[];
};
export type QuipResult = { expression: Expression; text: string; source: "model" | "canned" };

const KINDS: MascotEvent["kind"][] = ["generated", "upscaled", "error", "applied", "prompt_edit", "closet_use", "idle", "greet", "rp_feedback", "rp_chat", "rp_spy", "tap", "slime_out", "slime_in", "vial_drop"];
const CTX = 4096; // quick tier: small context so E4B stays light next to the brain

export function makeQuip(d: QuipDeps): (body: unknown) => Promise<QuipResult> {
  // One model request at a time: a timed-out request keeps running in Ollama, so later events go canned until it ends.
  let inFlight = false;
  let refreshing = false;

  async function refreshFacts(model: string): Promise<void> {
    if (refreshing || inFlight) return; // they share one model slot
    refreshing = true;
    const gen = d.generation?.();
    try {
      const p = factsPrompt(d.store.recent(25), d.context().taste, d.store.facts().map((f) => f.text));
      const facts = parseFacts(await d.ask(p.system, p.user, model, { num_ctx: CTX, num_predict: 600 }));
      if (d.generation && d.generation() !== gen) return; // slime switched: these facts belong to the old jar
      if (facts.length) d.store.setFacts(facts);
      d.store.markRefreshed(); // even with zero facts, or it re-fires after every quip
    } finally { refreshing = false; }
  }

  async function modelLine(e: MascotEvent, promptSummary: string): Promise<QuipResult | null> {
    // rp_spy lands right after an RP reply, while the gate is still paused: the heavy model is the one loaded.
    const heavy = e.kind === "rp_spy" && !!d.gate && !!d.heavyModel && d.gate.state === "heavy" && !d.gate.busy;
    if (inFlight || refreshing || (!heavy && d.heavyInUse())) return null;
    const model = heavy ? d.heavyModel!() : d.model();
    if (!(await d.installed()).includes(model)) return null;
    const c = d.context();
    const { system, user } = quipPrompt(e, {
      // Empty: the previous slime's lines and facts would pull her back into its voice.
      ...c, keys: d.keys?.(), promptSummary, facts: c.identity.empty ? [] : d.store.facts().map((f) => f.text), recent: c.identity.empty ? [] : d.store.recent(5).reverse().map((r) => r.line),
    });
    inFlight = true;
    // Heavy: no num_ctx, so the resident model isn't reloaded at another context size (explicit model ⇒ think:false).
    const ask = () => d.ask(system, user, model, { ...(heavy ? {} : { num_ctx: CTX }), num_predict: c.identity.lengthShape.quipPredict, temperature: 0.9 });
    const run = (heavy ? d.gate!.run(ask) : ask()).finally(() => { inFlight = false; });
    run.catch(() => {});
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), d.timeoutMs ?? 8000); });
    try {
      const q = parseQuip(await Promise.race([run, timeout]), d.keys?.().length ? d.keys!() : undefined, [c.identity.selfName, "miyabi"]);
      return q && { ...q, source: "model" };
    } finally { clearTimeout(t); }
  }

  function canned(kind: MascotEvent["kind"]): { expression: Expression; text: string } {
    let empty = false;
    try { empty = d.context().identity.empty; } catch { /* settings unreadable: her usual lines */ }
    if (!empty) return cannedLine(kind);
    const pool = kind === "slime_out" || kind === "slime_in" ? emptyLines[kind] : [DATA_RECEIVED];
    return { expression: "sleepy", text: pool[Math.floor(Math.random() * pool.length)] };
  }

  /** Never throws: any failure (offline, timeout, busy, DB) falls back to a canned line. */
  return async (body) => {
    const b = (body ?? {}) as { event?: { kind?: unknown; data?: unknown }; context?: { promptSummary?: unknown; nsfw?: unknown } };
    const kind = KINDS.includes(b.event?.kind as MascotEvent["kind"]) ? (b.event!.kind as MascotEvent["kind"]) : "tap";
    const data = b.event?.data && typeof b.event.data === "object" && !Array.isArray(b.event.data) ? (b.event.data as Record<string, unknown>) : undefined;
    const ps = typeof b.context?.promptSummary === "string" ? b.context.promptSummary : "";
    const mode = b.context?.nsfw === true ? "(NSFW mode)" : b.context?.nsfw === false ? "(SFW mode)" : "";
    // Empty slime: fixed line, no model, no journal, no facts refresh (slime_out/slime_in keep their own lines below).
    if (kind !== "slime_out" && kind !== "slime_in") {
      let empty = false;
      try { empty = d.context().identity.empty; } catch { /* settings unreadable: her usual path */ }
      if (empty) return { expression: "smug", text: DATA_RECEIVED, source: "canned" };
    }
    let out: QuipResult | null = null;
    try { out = await modelLine({ kind, at: Date.now(), data }, [mode, ps].filter(Boolean).join(" ")); } catch { /* canned below */ }
    out ??= { ...canned(kind), source: "canned" };
    try { if (kind === "idle") d.drift("idle"); } catch { /* drift is best-effort */ }
    try {
      d.store.log(kind, data ? JSON.stringify(data).slice(0, 200) : "", out.text);
      if (kind !== "slime_out" && kind !== "slime_in" && !d.heavyInUse() && !d.context().identity.empty && d.store.needsRefresh()) void refreshFacts(d.model()).catch(() => {});
    } catch { /* journal/DB trouble never costs the line */ }
    return out;
  };
}
