/** Just enough markdown for brain replies: headings, bullets, numbered items, bold/italic. */
export type MdBlock = { kind: "h" | "li" | "ol" | "p"; text: string };
export type Run = { t: string; b?: true; i?: true };

export function mdBlocks(s: string): MdBlock[] {
  const out: MdBlock[] = [];
  for (const line of s.split("\n")) {
    const h = line.match(/^#{1,6}\s+(.*)/);
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    const prev = out[out.length - 1];
    if (h) out.push({ kind: "h", text: h[1].trim() });
    else if (li) out.push({ kind: "li", text: li[1].trim() });
    else if (/^\s*\d+[.)]\s+/.test(line)) out.push({ kind: "ol", text: line.trim() });
    else if (!line.trim()) out.push({ kind: "p", text: "" });
    else if (prev?.kind === "p" && prev.text) prev.text += `\n${line}`;
    else out.push({ kind: "p", text: line });
  }
  return out.filter((b) => b.text);
}

export function inline(s: string): Run[] {
  return s.split(/(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/).filter(Boolean).map((t) =>
    t.startsWith("**") && t.endsWith("**") && t.length > 4 ? { t: t.slice(2, -2), b: true as const }
    : /^\*[^*\s][^*\n]*\*$/.test(t) ? { t: t.slice(1, -1), i: true as const }
    : { t });
}
