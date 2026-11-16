// Per-turn freshness notes from the chat's own recent replies: repeated phrases, a stuck burst shape, a silent cast
// member, a status block to keep current, and the character's voice. Pure; buildTurn feeds the notes to steerTurn.
import type { Mode } from "./types";
import type { RpProfile } from "./profile";

// A stat line: wrapped in **/*** or [ ] and holding a number (`***1 MERIT, 25 CP***`, `[HP 40/50]`); photo/react tags aren't.
const STATUS = /^\s*(?!\[(?:photo|react):)(?:\*{2,3}|\[)[^\n]*\d[^\n]*(?:\*{2,3}|\])\s*$/im;
export const hasStatus = (t: string) => STATUS.test(t);

// ponytail: a hand list of the house prose local RP models share; extend when a new tic shows up across characters.
const STOCK: [RegExp, string][] = [
  [/\btrembl\w*/i, "trembling"], [/\bbreath (?:hitch|catch)\w*/i, "breath hitches"], [/\beyes widen\w*/i, "eyes widen"],
  [/\bknuckles (?:turning |going )?white\b/i, "knuckles white"], [/\ba mix(?:ture)? of\b/i, "a mixture of"],
  [/\bcheeks (?:flush|redden)\w*/i, "cheeks flushing"], [/\bshivers? (?:down|up|ran)\b/i, "a shiver down the spine"],
  [/\bbarely above a whisper\b/i, "barely above a whisper"], [/\ba wave of\b/i, "a wave of"], [/\bcan(?:'|no)t help but\b/i, "can't help but"],
  [/\bsends? a jolt\b/i, "sends a jolt"], [/\bsmirk\w*/i, "smirking"],
];
const STOP = new Set("the a an and or but of to in on at for with as is it its her his she he i im you my your me him them they we that this was be so their our up out just then into from are were not no do did".split(" "));

const words = (t: string) => t.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);

/** Stock slop seen in the replies, then 3-word phrases used in 2+ replies (names, filler and status lines skipped), ≤ 6. */
export function repeatedPhrases(replies: string[], names: string[]): string[] {
  const prose = replies.map((r) => r.split("\n").filter((l) => !hasStatus(l)).join("\n"));
  const stock = STOCK.filter(([re]) => prose.some((r) => re.test(r))).map(([, s]) => s);
  const banned = new Set(names.flatMap(words));
  const seen = new Map<string, number>();
  for (const r of prose) {
    const w = words(r), grams = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) {
      const g = w.slice(i, i + 3);
      if (g.some((x) => banned.has(x)) || g.filter((x) => !STOP.has(x)).length < 2) continue;
      grams.add(g.join(" "));
    }
    for (const g of grams) seen.set(g, (seen.get(g) ?? 0) + 1);
  }
  // Overlapping grams ("she steps back", "steps back again") are one habit: keep the first.
  const overlap = (a: string, b: string) => { const x = a.split(" "), y = b.split(" "); return x.slice(1).join(" ") === y.slice(0, 2).join(" ") || y.slice(1).join(" ") === x.slice(0, 2).join(" "); };
  const grams: string[] = [];
  for (const [g] of [...seen].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])) if (!grams.some((p) => overlap(p, g))) grams.push(g);
  return [...stock, ...grams.filter((g) => !stock.some((s) => g.includes(s)))].slice(0, 6);
}

const bubbles = (r: string) => r.split(/\n-{3,}\n/).map((b) => b.trim()).filter(Boolean);
const unNamed = (b: string) => b.replace(/^[^:\n]{1,30}:\s*/, "");
const tailEmoji = (b: string) => b.match(/(\p{Extended_Pictographic})️?\s*$/u)?.[1] ?? "";
const endsAsking = (r: string) => /\?\s*(?:\p{Extended_Pictographic}️?\s*)*$/u.test(r.trim());

/** Notes for the next turn, from the chat's recent replies (text mode: bursts joined with `---`). */
export function freshNotes(replies: string[], o: { mode: Mode; cast: string[]; names: string[] }): string[] {
  const out: string[] = [];
  const last3 = replies.slice(-3);
  if (o.mode === "text" && last3.length === 3) {
    const first = last3.map((r) => words(unNamed(bubbles(r)[0] ?? ""))[0] ?? "");
    if (first[0] && first.every((f) => f === first[0])) out.push(`Don't open with "${first[0]}" again.`);
    const e = last3.map((r) => tailEmoji(bubbles(r).at(-1) ?? ""));
    if (e[0] && e.every((x) => x === e[0])) out.push(`Drop the ${e[0]} sign-off this time.`);
  }
  if (last3.length === 3 && last3.every(endsAsking)) out.push("End this one on a statement or an action, not a question.");
  if (o.mode === "text" && o.cast.length > 1 && replies.length >= 2) {
    const spoke = new Set(replies.slice(-2).flatMap(bubbles).map((b) => b.match(/^([^:\n]{1,30}):/)?.[1].trim().toLowerCase()).filter(Boolean));
    for (const c of o.cast.filter((c) => !spoke.has(c.toLowerCase())))
      out.push(`Let ${c} send their own texts this time, prefixed \`${c}:\` — in their own voice, not described by the others.`);
  }
  if (replies.length && hasStatus(replies.at(-1)!)) out.push("Update the status block: every number, item and name must reflect what just happened this turn — don't copy the old values.");
  const p = repeatedPhrases(replies.slice(-8), [...o.cast, ...o.names]);
  if (p.length) out.push(`Don't reuse these phrases from your recent replies: ${p.map((x) => `"${x}"`).join(", ")}.`);
  return out;
}

/** The character's own voice, said every turn so it beats the model's house style. Empty without one. */
export function voiceLine(p: RpProfile | null, name: string): string {
  if (!p) return "";
  const { register, tics } = p.speech;
  const parts = [register && `${name}'s voice: ${register}.`, tics.length && `Habits: ${tics.join("; ")}.`, p.wouldNever.length && `Would never: ${p.wouldNever.join("; ")}.`].filter(Boolean);
  return parts.length ? `${parts.join(" ")} Sound like ${name}, not like anyone else.` : "";
}
