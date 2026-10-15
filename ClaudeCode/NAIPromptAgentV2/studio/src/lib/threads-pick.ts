// Chat tab thread rules: Miyabi (deep talk) threads live only in the mascot sheet.
export const defaultThreadId = (threads: { id: number; persona: string }[]): number | null =>
  threads.find((t) => t.persona !== "miyabi")?.id ?? null;

export const newThreadPersona = <P extends string>(cur?: P): P | "neutral" => (!cur || cur === "miyabi" ? "neutral" : cur);
