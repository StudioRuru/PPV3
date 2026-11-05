import { applyCharacterOverrides, assembleMessages, settingsToOptions } from "./prompt";
import type { RpStore } from "./store";
import type { ChatMessage, RpSettings, SamplerOptions } from "./types";
import { selectVoiceLines, type Embed } from "./voice";

export type TurnDeps = { settings: RpSettings; storyBlock: string; heavy: string; installed: string[]; embed: Embed };
export type Turn = { messages: ChatMessage[]; options: SamplerOptions; model: string; truncated: boolean };

/**
 * Everything needed to ask the model for the next reply in a chat. With `replacing` (regenerate), history stops before
 * that reply. A chat/character model that isn't installed any more falls back to the heavy tier.
 */
const TWISTS = [
  "open with a different action or line than any draft", "give {{char}} a different emotional reaction", "focus on a different sensory detail",
  "let {{char}} take the initiative and push the scene forward", "change the pacing — slower and more intimate, or quicker and punchier",
];
const WILD = [
  "throw in a surprising turn of events nobody saw coming", "have {{char}} do something bold and out of their usual comfort zone",
  "escalate the scene dramatically", "reveal something unexpected about {{char}}", "flip the mood of the scene on its head",
];

/**
 * Regenerate = a genuinely different take, not a re-roll of the same one: the model sees its earlier drafts and is told
 * to avoid them, gets a random creative direction, a fresh seed, and a hotter sampler each retry. `wild` goes further.
 * min_p is floored so high temperatures stay coherent.
 */
export function varyTurn(turn: Turn, drafts: string[], wild: boolean, charName: string, rand = Math.random): Turn {
  const pick = (a: string[]) => a[Math.floor(rand() * a.length)].replaceAll("{{char}}", charName);
  const base = turn.options.temperature ?? 0.9;
  const heat = wild ? 0.5 : Math.min(0.1 + 0.08 * drafts.length, 0.35);
  const recent = drafts.slice(-3).map((d) => `- ${d.replace(/\s+/g, " ").slice(0, 280)}${d.length > 280 ? "…" : ""}`).join("\n");
  const note = `[Alternate take] Write a reply that is clearly different from these earlier drafts — different opening, different choices, different phrasing. Don't reuse their lines.\nDirection: ${pick(wild ? WILD : TWISTS)}.\nEarlier drafts:\n${recent}`;
  return {
    ...turn,
    messages: [...turn.messages, { role: "system", content: note }],
    options: {
      ...turn.options, temperature: Math.min(base + heat, wild ? 1.8 : 1.5), min_p: Math.max(turn.options.min_p ?? 0, wild ? 0.08 : 0.05),
      top_p: wild ? 1 : turn.options.top_p, seed: Math.floor(rand() * 2 ** 31),
    },
  };
}

export async function buildTurn(store: RpStore, chatId: number, deps: TurnDeps, replacing?: number, wild = false): Promise<Turn> {
  const chat = store.chat(chatId);
  if (!chat) throw new Error("Chat not found");
  // The chat's reply length also sets the token cap + context budget, or a per-chat "Epic" gets cropped at the global cap.
  const settings = { ...deps.settings, replyLength: chat.replyLength ?? deps.settings.replyLength };
  const character = chat.characterId ? store.character(chat.characterId) : null;
  const persona = store.persona(chat.personaId);
  let history = store.messages(chatId);
  if (replacing) history = history.filter((m) => m.id < replacing);
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const voiceLines = character ? await selectVoiceLines(store, character.id, lastUser, deps.settings.embedModel, deps.embed) : [];
  const r = assembleMessages({
    settings, character, persona, chat, history, voiceLines, storyBlock: deps.storyBlock,
    lore: store.loreFor(chat, character),
  });
  const pinned = [chat.model, character?.model].find((m) => m && deps.installed.includes(m));
  const turn: Turn = {
    messages: r.messages,
    options: applyCharacterOverrides(settingsToOptions(settings, r.stop), character?.samplerOverrides),
    model: pinned || deps.heavy,
    truncated: r.truncated,
  };
  const old = replacing ? store.messages(chatId).find((m) => m.id === replacing) : undefined;
  return old ? varyTurn(turn, old.swipes.length ? old.swipes : [old.content], wild, character?.name ?? "the character") : turn;
}
