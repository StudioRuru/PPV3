import { applyTags, newLine, splitTags, type Line, type PromptState } from "./prompt";

export type Op = { target: "base" | "uc" | "artist" | `char:${number}`; action: "add" | "remove" | "replace" | "weight"; line: string; weight?: number };

const ACTIONS = new Set(["add", "remove", "replace", "weight"]);
const key = (t: string) => t.trim().toLowerCase();
const bare = (t: string) => t.replace(/^-?[\d.]+::/, "").replace(/::$/, "").trim();

function validOp(o: unknown): o is Op {
  const v = o as Op;
  if (!v || typeof v.line !== "string" || !ACTIONS.has(v.action)) return false;
  if (!(v.target === "base" || v.target === "uc" || v.target === "artist" || /^char:\d+$/.test(String(v.target)))) return false;
  if (v.weight !== undefined && typeof v.weight !== "number") return false;
  return v.action !== "weight" || typeof v.weight === "number";
}

/** Brain reply → prose + the ops from its last fenced json block. Invalid ops are dropped, never thrown. */
export function parseReply(text: string): { prose: string; ops: Op[]; error?: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  // A block still streaming in has no closing fence yet: hide it until it completes.
  if (!blocks.length) {
    const warn = text.match(/\n\n⚠️[^\n]*$/)?.[0] ?? "";
    const open = text.search(/```json/i);
    return { prose: (open < 0 ? text : text.slice(0, open).trim() + warn).trim(), ops: [] };
  }
  const last = blocks[blocks.length - 1];
  const prose = (text.slice(0, last.index) + text.slice(last.index! + last[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  try {
    const raw = JSON.parse(last[1]).ops;
    const ops = limitEmphasis(Array.isArray(raw) ? raw.filter(validOp) : []);
    return ops.length || !raw?.length ? { prose, ops } : { prose, ops, error: "No usable changes in that reply — ask again." };
  } catch {
    return { prose, ops: [], error: "Couldn't read the suggested changes — ask again." };
  }
}

/**
 * The brain over-emphasises. Keep weights on at most 2 added/replaced lines, within 0.8–1.3; the rest come in
 * unweighted. An explicit "weight" op is the user asking — left alone.
 */
function limitEmphasis(ops: Op[]): Op[] {
  let kept = 0;
  return ops.map((o) => {
    if (o.action === "weight" || o.weight === undefined || o.weight === 1) return o;
    if (++kept > 2) return { ...o, weight: undefined };
    return { ...o, weight: Math.min(1.3, Math.max(0.8, o.weight)) };
  });
}

function removeTag(lines: Line[], tag: string): Line[] {
  return lines
    .map((l) => ({ ...l, text: splitTags(l.text).filter((t) => key(t) !== key(tag)).join(", ") }))
    .filter((l) => l.text.trim());
}

/** "1.2::tag::" in an op line → plain text + weight; the op's own weight wins. */
function unwrap(op: Op): Op {
  const m = op.line.trim().match(/^(-?[\d.]+)::([\s\S]*?)::$/);
  return m ? { ...op, line: m[2].trim(), weight: op.weight ?? Number(m[1]) } : op;
}

function editLines(lines: Line[], raw: Op): Line[] {
  const op = unwrap(raw);
  switch (op.action) {
    case "add": {
      // Re-applying a card must not stack duplicate lines.
      const kept = lines.filter((l) => l.text.trim());
      return kept.some((l) => key(l.text) === key(op.line)) ? kept : [...kept, newLine(op.line, op.weight)];
    }
    case "replace": return [newLine(op.line, op.weight)];
    case "remove": return splitTags(op.line).reduce(removeTag, lines);
    case "weight": {
      const i = lines.findIndex((l) => key(l.text) === key(op.line));
      if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, weight: op.weight } : l));
      return [...removeTag(lines, op.line), newLine(op.line, op.weight)];
    }
  }
}

function editUc(uc: string, op: Op): string {
  const tags = splitTags(uc);
  const add = splitTags(op.line);
  if (op.action === "replace") return op.line.trim();
  if (op.action === "remove") return tags.filter((t) => !add.some((a) => key(a) === key(t))).join(", ");
  return [...tags, ...add.filter((a) => !tags.some((t) => key(t) === key(a)))].join(", ");
}

export function applyOps(s: PromptState, ops: Op[]): PromptState {
  return ops.reduce((acc, op) => {
    if (op.target === "uc") return { ...acc, uc: editUc(acc.uc, op) };
    if (op.target === "base") return { ...acc, base: editLines(acc.base, op) };
    if (op.target === "artist") return { ...acc, artists: editLines(acc.artists ?? [], op) };
    // Out-of-range indices append one new character, never a run of empty boxes.
    const n = Math.min(Number(op.target.slice(5)), acc.chars.length);
    const grown = acc.chars.length > n ? acc : applyTags(acc, n, "append", "");
    const chars = grown.chars.map((c, i) => (i === n ? { ...c, lines: editLines(c.lines.filter((l) => l.text.trim()), op) } : c));
    return { ...grown, chars };
  }, s);
}

/** Tags the user actually wants more of: added/replaced/weighted in the prompt — never removals or UC (negatives). */
export function learnTags(ops: Op[]): string[] {
  return opTags(ops.filter((o) => o.action !== "remove" && o.target !== "uc"));
}

/** Tag-shaped pieces of every op (≤3 words) for the CSV/YAML check; sentences are natural language. */
export function opTags(ops: Op[]): string[] {
  const out = new Set<string>();
  for (const op of ops) for (const t of splitTags(op.line).map(bare)) if (t && t.split(/\s+/).length <= 3) out.add(t);
  return [...out];
}
