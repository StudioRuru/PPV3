// Quip orchestration with injected deps (db/llm wiring lives in quip.ts) so it can be unit-tested.
import type { Modifiers } from "../persona";
import { cannedLine, parseQuip, type Expression, type MascotEvent } from "./core";
import { quipPrompt } from "./prompt";
import { factsPrompt, parseFacts, type MascotStore } from "./store";

export type QuipDeps = {
  /** Heavy model paused the servers or is replying (HeavyGate state "heavy" or busy). */
  heavyInUse: () => boolean;
  model: () => string;
  installed: () => Promise<string[]>;
  context: () => { mods: Modifiers; drift: number; taste: string; story: string };
  store: Pick<MascotStore, "log" | "recent" | "facts" | "needsRefresh" | "setFacts" | "markRefreshed">;
  /** One full reply; no timeout (the runner adds it). */
  ask: (system: string, user: string, model: string, options: Record<string, unknown>) => Promise<string>;
  timeoutMs?: number;
};
export type QuipResult = { expression: Expression; text: string; source: "model" | "canned" };

const KINDS: MascotEvent["kind"][] = ["generated", "upscaled", "error", "applied", "prompt_edit", "closet_use", "idle", "greet", "rp_feedback", "rp_chat", "tap"];
const CTX = 4096; // quick tier: small context so E4B stays light next to the brain

export function makeQuip(d: QuipDeps): (body: unknown) => Promise<QuipResult> {
  // One model request at a time: a timed-out request keeps running in Ollama, so later events go canned until it ends.
  let inFlight = false;
  let refreshing = false;

  async function refreshFacts(model: string): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const p = factsPrompt(d.store.recent(25), d.context().taste, d.store.facts().map((f) => f.text));
      const facts = parseFacts(await d.ask(p.system, p.user, model, { num_ctx: CTX, num_predict: 600 }));
      if (facts.length) { d.store.setFacts(facts); d.store.markRefreshed(); }
    } finally { refreshing = false; }
  }

  async function modelLine(e: MascotEvent, promptSummary: string): Promise<QuipResult | null> {
    if (inFlight || d.heavyInUse()) return null;
    const model = d.model();
    if (!(await d.installed()).includes(model)) return null;
    const c = d.context();
    const { system, user } = quipPrompt(e, {
      ...c, promptSummary, facts: d.store.facts().map((f) => f.text), recent: d.store.recent(5).reverse().map((r) => r.line),
    });
    inFlight = true;
    const run = d.ask(system, user, model, { num_ctx: CTX, num_predict: 120, temperature: 0.9 }).finally(() => { inFlight = false; });
    run.catch(() => {});
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), d.timeoutMs ?? 8000); });
    try {
      const q = parseQuip(await Promise.race([run, timeout]));
      return q && { ...q, source: "model" };
    } finally { clearTimeout(t); }
  }

  /** Never throws: any failure (offline, timeout, busy, DB) falls back to a canned line. */
  return async (body) => {
    const b = (body ?? {}) as { event?: { kind?: unknown; data?: unknown }; context?: { promptSummary?: unknown; nsfw?: unknown } };
    const kind = KINDS.includes(b.event?.kind as MascotEvent["kind"]) ? (b.event!.kind as MascotEvent["kind"]) : "tap";
    const data = b.event?.data && typeof b.event.data === "object" && !Array.isArray(b.event.data) ? (b.event.data as Record<string, unknown>) : undefined;
    const ps = typeof b.context?.promptSummary === "string" ? b.context.promptSummary : "";
    const mode = b.context?.nsfw === true ? "(NSFW mode)" : b.context?.nsfw === false ? "(SFW mode)" : "";
    let out: QuipResult | null = null;
    try { out = await modelLine({ kind, at: Date.now(), data }, [mode, ps].filter(Boolean).join(" ")); } catch { /* canned below */ }
    out ??= { ...cannedLine(kind), source: "canned" };
    try {
      d.store.log(kind, data ? JSON.stringify(data).slice(0, 200) : "", out.text);
      if (!d.heavyInUse() && d.store.needsRefresh()) void refreshFacts(d.model()).catch(() => {});
    } catch { /* journal/DB trouble never costs the line */ }
    return out;
  };
}
