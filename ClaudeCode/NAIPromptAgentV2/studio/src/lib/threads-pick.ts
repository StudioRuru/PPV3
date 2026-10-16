// Chat tab thread rules: the Chat tab is Miyabi's; Aru's threads live only in her shop sheet.
const onChatTab = (t: { persona: string }) => t.persona !== "aru";
export const chatTabThreads = <T extends { persona: string }>(threads: T[]): T[] => threads.filter(onChatTab);
export const defaultThreadId = (threads: { id: number; persona: string }[]): number | null => threads.find(onChatTab)?.id ?? null;

/** New chat threads are always Miyabi's. */
export const newThreadPersona = (): "miyabi" => "miyabi";
