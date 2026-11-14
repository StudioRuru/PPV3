import { DEFAULT_SYSTEM_PROMPT } from "./presets";

// Row shapes for the rp_* tables, camelCase (the ported Delfino code reads these names).

export type RpCharacter = {
  id: number; name: string; avatarPath: string | null;
  description: string; personality: string; scenario: string; firstMessage: string; exampleDialogue: string;
  systemPrompt: string; postHistoryInstructions: string; alternateGreetings: string; creatorNotes: string; tags: string;
  lorebookId: number | null; worldLorebookId: number | null; model: string | null; samplerOverrides: string | null;
  appearancePrompt: string; outfitPrompt: string; bodyProps: string; agency: number | null;
  povMode: string; tense: string; dialogueStyle: string; stateSchema: string;
  /** Name used in prompts + headers (the card title is just the list label). */
  displayName: string;
  /** RpProfile JSON (see profile.ts), extracted at import and hand-editable. */
  profile: string | null;
  createdAt: number; updatedAt: number;
};

export type RpPersona = {
  id: number; name: string; description: string; avatarPath: string | null; isDefault: number;
  relationship: string; addressAs: string; boundaries: string; createdAt: number; updatedAt: number;
};

export type RpChat = {
  id: number; characterId: number | null; personaId: number | null; title: string; model: string | null;
  lorebookId: number | null; showBackground: number; authorNote: string; authorNoteDepth: number; wallpaperPath: string | null;
  replyLength: number | null; replySpice: number | null; replyAgency: number | null;
  memorySummary: string; summarizedThrough: number; mods: string; stateValues: string;
  /** JSON string[] of facts learned in this chat (summarizer, max 20) — never written into the profile. */
  learned: string;
  /** "" = card default, "chat" = close personal one-on-one, "story" = narrated novel prose. */
  style: string;
  /** Hidden planning step: null = follow settings.thinkByMode, 0 = off, 1 = on. */
  think: number | null;
  createdAt: number; updatedAt: number;
};

export type RpMessage = {
  id: number; chatId: number; role: "user" | "assistant" | "system"; content: string;
  swipes: string[]; activeSwipeIndex: number; createdAt: number; updatedAt: number; thought: string;
};

/** Global RP settings (Delfino's settings row, the fields RP still uses). Stored as JSON under settings key `rp:settings`. */
export type RpSettings = {
  systemPromptTemplate: string; jailbreakPrompt: string;
  temperature: number; topP: number; topK: number; repeatPenalty: number; minP: number; numCtx: number;
  replyLength: number; replySpice: number; replyAgency: number; mods: string; loreBudgetPct: number; embedModel: string;
  thinkByMode: Record<Mode, boolean>;
};

/** "text" = phone-style texting, "rp" = scene roleplay. */
export type Mode = "text" | "rp";

export const DEFAULT_RP_SETTINGS: RpSettings = {
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT, jailbreakPrompt: "",
  temperature: 0.8, topP: 0.95, topK: 40, repeatPenalty: 1.1, minP: 0.05, numCtx: 16384,
  replyLength: 2, replySpice: 2, replyAgency: 2, mods: "{}", loreBudgetPct: 25, embedModel: "bge-m3:latest",
  thinkByMode: { text: false, rp: false },
};

/** Message for Ollama /api/chat. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string; images?: string[] };
export type SamplerOptions = {
  temperature?: number; top_p?: number; top_k?: number; repeat_penalty?: number; min_p?: number;
  num_ctx?: number; num_predict?: number; stop?: string[]; seed?: number;
};

const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** snake_case DB row → camelCase object. */
export function camel<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
}
/** camelCase object → snake_case column map (undefined values dropped). */
export function snake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));
}
