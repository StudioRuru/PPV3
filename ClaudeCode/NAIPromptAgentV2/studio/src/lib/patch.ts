import { applyTags, newLine, splitTags, type Line, type PromptState } from "./prompt";

export type Op = { target: "base" | "uc" | `char:${number}`; action: "add" | "remove" | "replace" | "weight"; line: string; weight?: number };

const ACTIONS = new Set(["add", "remove", "replace", "weight"]);
const key = (t: string) => t.trim().toLowerCase();
const bare = (t: string) => t.replace(/^-?[\d.]+::/, "").replace(/::$/, "").trim();

function validOp(o: unknown): o is Op {
  const v = o as Op;
  if (!v || typeof v.line !== "string" || !ACTIONS.has(v.action)) return false;
  if (!(v.target === "base" || v.target === "uc" || /^char:\d+$/.test(String(v.target)))) return false;
  if (v.weight !== undefined && typeof v.weight !== "number") return false;
  return v.action !== "weight" || typeof v.weight === "number";
}

/** Brain reply → prose + the ops from its last fenced json block. Invalid ops are dropped, never thrown. */
export function parseReply(text: string): { prose: string; ops: Op[]; error?: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return { prose: text.trim(), ops: [] };
  const last = blocks[blocks.length - 1];
  const prose = (text.slice(0, last.index) + text.slice(last.index! + last[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  try {
    const ops = JSON.parse(last[1]).ops;
    return { prose, ops: Array.isArray(ops) ? ops.filter(validOp) : [] };
  } catch {
    return { prose, ops: [], error: "Couldn't read the suggested changes — ask again." };
  }
}

function removeTag(lines: Line[], tag: string): Line[] {
  return lines
    .map((l) => ({ ...l, text: splitTags(l.text).filter((t) => key(t) !== key(tag)).join(", ") }))
    .filter((l) => l.text.trim());
}

function editLines(lines: Line[], op: Op): Line[] {
  switch (op.action) {
    case "add": return [...lines.filter((l) => l.text.trim()), newLine(op.line, op.weight)];
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
    const n = Number(op.target.slice(5));
    const grown = acc.chars.length > n ? acc : applyTags(acc, n, "append", "");
    const chars = grown.chars.map((c, i) => (i === n ? { ...c, lines: editLines(c.lines.filter((l) => l.text.trim()), op) } : c));
    return { ...grown, chars };
  }, s);
}

/** Tag-shaped pieces of every op (≤3 words) for the CSV/YAML check; sentences are natural language. */
export function opTags(ops: Op[]): string[] {
  const out = new Set<string>();
  for (const op of ops) for (const t of splitTags(op.line).map(bare)) if (t && t.split(/\s+/).length <= 3) out.add(t);
  return [...out];
}
