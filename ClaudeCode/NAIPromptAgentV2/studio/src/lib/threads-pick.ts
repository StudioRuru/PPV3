// Chat tab thread rules: Miyabi (deep talk) and Aru (shop) threads live only in the mascot sheet.
const onChatTab = (t: { persona: string }) => t.persona !== "miyabi" && t.persona !== "aru";
export const chatTabThreads = <T extends { persona: string }>(threads: T[]): T[] => threads.filter(onChatTab);
export const defaultThreadId = (threads: { id: number; persona: string }[]): number | null => threads.find(onChatTab)?.id ?? null;

export const newThreadPersona = <P extends string>(cur?: P): P | "neutral" => (!cur || cur === "miyabi" || cur === "aru" ? "neutral" : cur);
