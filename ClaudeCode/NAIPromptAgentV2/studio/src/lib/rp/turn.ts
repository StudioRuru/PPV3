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
export async function buildTurn(store: RpStore, chatId: number, deps: TurnDeps, replacing?: number): Promise<Turn> {
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
  return {
    messages: r.messages,
    options: applyCharacterOverrides(settingsToOptions(settings, r.stop), character?.samplerOverrides),
    model: pinned || deps.heavy,
    truncated: r.truncated,
  };
}
