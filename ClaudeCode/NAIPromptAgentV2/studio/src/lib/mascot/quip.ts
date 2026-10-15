import "server-only";
import { db, getSetting } from "@/lib/db";
import { BRAIN_MODEL } from "@/lib/env";
import { getDrift, learnedBlock, learnedStoryBlock } from "@/lib/learning";
import { chatStream, heavyGate } from "@/lib/llm";
import { installedModels } from "@/lib/rp/server";
import { tierModel } from "@/lib/tiers";
import { cannedLine, parseQuip, type Expression, type MascotEvent } from "./core";
import { quipPrompt } from "./prompt";
import { getMascotSettings } from "./settings-db";
import { factsPrompt, MascotStore, parseFacts } from "./store";

export const mascotStore = new MascotStore(db);

const KINDS: MascotEvent["kind"][] = ["generated", "upscaled", "error", "applied", "prompt_edit", "closet_use", "idle", "greet", "rp_feedback", "rp_chat", "tap"];
const QUIP_MS = 8000;

/** Collect one quick-tier reply, rejecting after ms. ponytail: the Ollama request runs on after a timeout (num_predict bounds it); add an abort signal to chatStream if that matters. */
async function ask(system: string, user: string, model: string, ms: number, numPredict: number): Promise<string> {
  const run = (async () => {
    let s = "";
    for await (const c of chatStream(system, [{ role: "user", content: user }], { model, options: { num_predict: numPredict, temperature: 0.9 } })) s += c;
    return s;
  })();
  run.catch(() => {});
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); });
  try { return await Promise.race([run, timeout]); } finally { clearTimeout(t); }
}

let refreshing = false;
async function refreshFacts(model: string): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const p = factsPrompt(mascotStore.recent(25), learnedBlock(), mascotStore.facts().map((f) => f.text));
    const facts = parseFacts(await ask(p.system, p.user, model, 60_000, 600));
    if (facts.length) { mascotStore.setFacts(facts); mascotStore.markRefreshed(); }
  } finally { refreshing = false; }
}

/** One line from Miyabi for an event. Never throws: any failure falls back to a canned line. Always journaled. */
export async function quip(body: unknown): Promise<{ expression: Expression; text: string; source: "model" | "canned" }> {
  const b = (body ?? {}) as { event?: { kind?: unknown; data?: unknown }; context?: { promptSummary?: unknown; nsfw?: unknown } };
  const kind = KINDS.includes(b.event?.kind as MascotEvent["kind"]) ? (b.event!.kind as MascotEvent["kind"]) : "tap";
  const data = b.event?.data && typeof b.event.data === "object" && !Array.isArray(b.event.data) ? (b.event.data as Record<string, unknown>) : undefined;
  const e: MascotEvent = { kind, at: Date.now(), data };
  const model = tierModel("quick", getSetting, BRAIN_MODEL);
  let out: { expression: Expression; text: string; source: "model" | "canned" } | null = null;
  try {
    if (heavyGate.state !== "heavy" && (await installedModels()).includes(model)) {
      const ps = typeof b.context?.promptSummary === "string" ? b.context.promptSummary : "";
      const { system, user } = quipPrompt(e, {
        mods: getMascotSettings().mods, drift: getDrift("miyabi"),
        promptSummary: [b.context?.nsfw === true ? "(NSFW mode)" : b.context?.nsfw === false ? "(SFW mode)" : "", ps].filter(Boolean).join(" "),
        taste: learnedBlock(), story: learnedStoryBlock(),
        facts: mascotStore.facts().map((f) => f.text),
        recent: mascotStore.recent(5).reverse().map((r) => r.line),
      });
      const q = parseQuip(await ask(system, user, model, QUIP_MS, 120));
      if (q) out = { ...q, source: "model" };
    }
  } catch { /* offline, timeout or bad reply: canned below */ }
  out ??= { ...cannedLine(kind), source: "canned" };
  mascotStore.log(kind, data ? JSON.stringify(data).slice(0, 200) : "", out.text);
  if (heavyGate.state !== "heavy" && mascotStore.needsRefresh()) void refreshFacts(model).catch(() => {});
  return out;
}
