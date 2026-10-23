// Client-safe: pure string helpers for LoRA trigger words in the prompt.
const tokens = (prompt: string) => prompt.split(",").map((t) => t.trim()).filter(Boolean);
const key = (s: string) => s.trim().toLowerCase();

/** Prepends the words the prompt doesn't already have (whole-token, case-insensitive). Returns what it inserted. */
export function addTriggers(prompt: string, words: string[]): { prompt: string; inserted: string[] } {
  const have = new Set(tokens(prompt).map(key));
  const inserted: string[] = [];
  for (const w of words.map((x) => x.trim())) {
    if (!w || have.has(key(w))) continue;
    have.add(key(w));
    inserted.push(w);
  }
  if (!inserted.length) return { prompt, inserted };
  const rest = prompt.trim();
  return { prompt: [...inserted, ...(rest ? [rest] : [])].join(", "), inserted };
}

/** Removes one token per inserted word, then tidies commas and spaces. Owner-typed words are never in `inserted`, so they stay. */
export function removeTriggers(prompt: string, inserted: string[]): string {
  const list = tokens(prompt);
  for (const w of inserted) {
    const i = list.findIndex((t) => key(t) === key(w));
    if (i >= 0) list.splice(i, 1);
  }
  return list.join(", ");
}
