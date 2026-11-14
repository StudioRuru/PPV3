/**
 * Parse a character card's example dialogue (V2 `mes_example`) into real
 * alternating chat turns. Models imitate a character's voice far better from
 * actual user/assistant messages than from a prose blob pasted into the system
 * prompt, so {@link parseExampleDialogue} turns
 *
 *   {{user}}: Hi there.
 *   {{char}}: *grins* Took you long enough.
 *
 * into `[{role:"user",...}, {role:"assistant",...}]`. SillyTavern `<START>`
 * separators are dropped, and either macro labels ({{char}}/{{user}}/<BOT>/
 * <USER>) or the resolved character/persona names are recognised as speakers.
 *
 * Pure and dependency-free (mirrors substituteMacros from prompt.ts) so it can
 * be unit-tested without the server-only prompt module.
 */

export interface ExampleTurn {
  role: "user" | "assistant";
  content: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function substitute(text: string, charName: string, userName: string): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<BOT>/g, charName)
    .replace(/<USER>/g, userName);
}

/**
 * Split example dialogue into alternating turns. Returns `[]` when the text has
 * no recognisable speaker labels (free-form examples), so callers can fall back
 * to injecting the raw text instead.
 */
export function parseExampleDialogue(
  text: string,
  charName: string,
  userName: string,
): ExampleTurn[] {
  const raw = text?.trim();
  if (!raw) return [];

  // Speaker labels we accept at the start of a line, longest-first so a name
  // that is a prefix of another doesn't shadow it. Char-side -> assistant.
  const charLabels = ["{{char}}", "<BOT>", charName].filter(Boolean);
  const userLabels = ["{{user}}", "<USER>", userName].filter(Boolean);
  const labels = [...charLabels, ...userLabels]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => b.length - a.length);
  const roleOf = (label: string): "user" | "assistant" =>
    charLabels.some((l) => l.toLowerCase() === label.toLowerCase())
      ? "assistant"
      : "user";

  const labelRe = new RegExp(
    `^\\s*(${labels.map(escapeRegExp).join("|")})\\s*:\\s*(.*)$`,
    "i",
  );
  const startRe = /^\s*<START>\s*$/i;

  const turns: ExampleTurn[] = [];
  let current: ExampleTurn | null = null;
  const push = () => {
    if (current && current.content.trim()) {
      current.content = substitute(current.content.trim(), charName, userName);
      turns.push(current);
    }
    current = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (startRe.test(line)) {
      push();
      continue;
    }
    const m = line.match(labelRe);
    if (m) {
      push();
      current = { role: roleOf(m[1]), content: m[2] };
    } else if (current) {
      // Continuation of the current speaker's multi-line message.
      current.content += `\n${line}`;
    }
    // Lines before the first label (free-form preamble) are ignored.
  }
  push();

  return turns;
}

/**
 * Ensemble cards (one card, several characters): split example text into lines per named speaker, so each sister/rival
 * keeps a labelled voice instead of collapsing into one "{{char}}". Multi-line messages continue the last speaker;
 * `<START>` and unlabelled preamble are dropped.
 */
export function splitBySpeaker(example: string, cast: string[]): { speaker: string; text: string }[] {
  const names = [...new Set(cast.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.length || !example?.trim()) return [];
  const re = new RegExp(`^\\s*(${names.map(escapeRegExp).join("|")})\\s*:\\s*(.*)$`, "i");
  const out: { speaker: string; text: string }[] = [];
  for (const line of example.split(/\r?\n/)) {
    if (/^\s*<START>\s*$/i.test(line)) continue;
    const m = line.match(re);
    if (m) out.push({ speaker: names.find((n) => n.toLowerCase() === m[1].toLowerCase())!, text: m[2] });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text);
}
