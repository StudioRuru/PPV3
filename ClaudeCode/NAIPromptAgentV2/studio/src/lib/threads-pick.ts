// Chat tab thread rules: Miyabi (deep talk) and Aru (shop) threads live only in the mascot sheet.
export const defaultThreadId = (threads: { id: number; persona: string }[]): number | null =>
  threads.find((t) => t.persona !== "miyabi" && t.persona !== "aru")?.id ?? null;

export const newThreadPersona = <P extends string>(cur?: P): P | "neutral" => (!cur || cur === "miyabi" || cur === "aru" ? "neutral" : cur);
