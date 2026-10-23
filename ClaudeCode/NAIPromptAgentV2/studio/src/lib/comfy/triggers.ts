// Client-safe: pure string helpers for LoRA trigger words in the prompt.
const tokens = (prompt: string) => prompt.split(",").map((t) => t.trim()).filter(Boolean);
// Weighting ignored: "(word:1.2)", "{word}", "[word]" all count as "word".
const key = (s: string) => s.trim().replace(/^[({[]+/, "").replace(/[)}\]]+$/, "").replace(/:\s*-?\d+(\.\d+)?$/, "").trim().toLowerCase();

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

/** Removes the first matching comma segment per inserted word, in place: the owner's other text keeps its exact spacing. Owner-typed words are never in `inserted`, so they stay. */
export function removeTriggers(prompt: string, inserted: string[]): string {
  const segs = prompt.split(",");
  let changed = false;
  for (const w of inserted) {
    if (!key(w)) continue;
    const i = segs.findIndex((s) => key(s) === key(w));
    if (i < 0) continue;
    segs.splice(i, 1); // joining with one "," eats exactly one separator
    if (i === 0 && segs.length) segs[0] = segs[0].trimStart();
    changed = true;
  }
  return changed ? segs.join(",") : prompt;
}
