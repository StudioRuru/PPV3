// Chat tab thread rules: the Chat tab is Miyabi's; Aru's threads live only in her shop sheet.
const onChatTab = (t: { persona: string }) => t.persona !== "aru";
export const chatTabThreads = <T extends { persona: string }>(threads: T[]): T[] => threads.filter(onChatTab);
export const defaultThreadId = (threads: { id: number; persona: string }[]): number | null => threads.find(onChatTab)?.id ?? null;

/** New chat threads are always Miyabi's. */
export const newThreadPersona = (): "miyabi" => "miyabi";

/** Chat tab composer: Miyabi talks on the heavy model, so she needs Ollama reachable, not the brain loaded (the heavy pause unloads it); an empty slime needs no model. */
export const canCompose = (s: { on: boolean; brain: boolean } | null, empty: boolean): boolean => empty || !!s?.brain;

/** Just Chat threads: no mode chips or patch cards, a notebook instead of taste. */
export const isCompanion = (t: { mode?: string } | null): boolean => t?.mode === "companion";
