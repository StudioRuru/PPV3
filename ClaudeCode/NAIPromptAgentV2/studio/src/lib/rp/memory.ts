// Rolling "story so far" memory, ported from Delfino Plaza src/lib/memory.ts. Callers fire it detached after a reply.
import { substituteMacros } from "./prompt";
import type { RpStore } from "./store";
import type { ChatMessage } from "./types";

/** Fold at most this many turns per pass, to bound the call. */
export const MAX_FOLD = 60;
const SUMMARY_NUM_PREDICT = 600;

type Turn = { id: number; role: string; content: string };

/** Turns past the high-water mark (oldest first, capped), and the new mark; null when nothing is new. */
export function foldPlan<T extends Turn>(messages: T[], summarizedThrough: number, maxFold = MAX_FOLD): { batch: T[]; through: number } | null {
  const fresh = messages.filter((m) => m.role !== "system" && m.id > summarizedThrough);
  if (!fresh.length) return null;
  const batch = fresh.slice(0, maxFold);
  return { batch, through: batch[batch.length - 1].id };
}

export type SummarizeDeps = {
  model: string;
  stream: (messages: ChatMessage[], options: Record<string, unknown>) => AsyncIterable<string>;
  numCtx?: number;
};

export async function summarizeChat(store: RpStore, chatId: number, deps: SummarizeDeps): Promise<void> {
  const chat = store.chat(chatId);
  if (!chat) return;
  const plan = foldPlan(store.messages(chatId), chat.summarizedThrough);
  if (!plan) return;

  const character = chat.characterId ? store.character(chat.characterId) : null;
  const persona = store.persona(chat.personaId);
  const charName = character?.name || "the character";
  const userName = persona?.name || "User";
  const sub = (t: string) => substituteMacros(t, charName, userName);
  const transcript = plan.batch.map((m) => `${m.role === "assistant" ? charName : userName}: ${sub(m.content).trim()}`).join("\n\n");
  const prior = chat.memorySummary.trim();

  const system =
    `You are a story archivist maintaining the long-term memory of an ongoing roleplay ` +
    `between ${userName} and ${charName}. Update the running summary so it captures everything ` +
    `needed to continue the story later: key facts, decisions, the state and dynamics of their ` +
    `relationship, important emotional beats, promises or commitments made, and unresolved threads. ` +
    `Write in past tense and the third person, concise but complete. Output ONLY the updated ` +
    `summary text — no preamble, headings, or commentary.`;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: `Existing summary:\n${prior || "(none yet)"}\n\nNew events to fold in:\n${transcript}\n\nWrite the updated summary.` },
  ];

  let out = "";
  for await (const d of deps.stream(messages, { temperature: 0.3, num_ctx: deps.numCtx ?? 16384, num_predict: SUMMARY_NUM_PREDICT })) out += d;
  const summary = out.trim();
  if (!summary) return; // never clobber a good summary with an empty result
  store.updateChat(chatId, { memorySummary: summary, summarizedThrough: plan.through });
}

/** Refresh memory once enough new turns accrued, or as soon as history started being trimmed (Delfino's trigger). */
export function shouldSummarize(messages: Turn[], summarizedThrough: number, truncated: boolean, trigger = 20): boolean {
  const fresh = messages.filter((m) => m.role !== "system" && m.id > summarizedThrough).length;
  return fresh > 0 && (truncated || fresh >= trigger);
}
