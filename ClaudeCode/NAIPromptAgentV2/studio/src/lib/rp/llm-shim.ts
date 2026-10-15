// Stands in for Delfino's provider layer so the ported studio code runs unchanged on Studio's Ollama client.
import { chatStream } from "@/lib/llm";
import type { ChatMessage, RpSettings, SamplerOptions } from "./types";

/** RP settings plus the model the character studio runs on (the heavy tier). */
export type Settings = RpSettings & { studioModel: string };
export type { ChatMessage };

export const defaultModelFor = (s: Settings): string | null => s.studioModel || null;
export const getProvider = (_s: Settings) => ({
  streamChat: ({ model, messages, options }: { model: string; messages: ChatMessage[]; options?: SamplerOptions; signal?: AbortSignal }) =>
    chatStream("", messages, { model, options, system: false }),
});
