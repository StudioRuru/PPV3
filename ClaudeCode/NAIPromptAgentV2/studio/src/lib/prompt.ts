export type Line = { id: string; text: string; weight?: number; enabled: boolean };
export type CharBox = { id: string; lines: Line[]; uc: string; center?: { x: number; y: number }; enabled: boolean };
export type Rating = "safe" | "nsfw" | "off";
export type PromptState = { base: Line[]; chars: CharBox[]; uc: string; rating: Rating };
export type CompiledChar = { prompt: string; uc: string; center?: { x: number; y: number } };
export type Compiled = { base: string; uc: string; chars: CompiledChar[] };

/** Tags the rating switch adds to the base / UC. Tunable here, nowhere else. */
export const RATING_TAGS: Record<Rating, { add: string[]; uc: string[] }> = {
  safe: { add: ["rating:general"], uc: ["nsfw"] },
  nsfw: { add: ["nsfw"], uc: [] },
  off: { add: [], uc: [] },
};

export const DEFAULT_UC =
  "worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad hands, missing fingers, extra fingers, extra digit, fewer digits, error, jpeg artifacts, watermark, username, blurry, signature, cropped";

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export function newLine(text = "", weight?: number): Line {
  return { id: uid(), text, weight, enabled: true };
}

export function emptyState(): PromptState {
  return { base: [newLine()], chars: [], uc: DEFAULT_UC, rating: "nsfw" };
}

/** Split on commas/newlines, keeping `w::…::` runs whole. */
export function splitTags(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inWeight = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":" && s[i + 1] === ":") { inWeight = !inWeight; buf += "::"; i++; continue; }
    if ((s[i] === "," || s[i] === "\n") && !inWeight) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else buf += s[i];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const fmt = (w: number) => String(Number(w.toFixed(2)));

export function lineToText(l: Line): string {
  const t = l.text.trim().replace(/,\s*$/, "");
  if (!t) return "";
  return l.weight === undefined || l.weight === 1 ? t : `${fmt(l.weight)}::${t}::`;
}

function joinLines(lines: Line[]): string {
  return lines.filter((l) => l.enabled).map(lineToText).filter(Boolean).join(", ");
}

const key = (t: string) => t.trim().toLowerCase();

function addMissing(prompt: string, tags: string[]): string {
  const have = new Set(splitTags(prompt).map(key));
  const extra = tags.filter((t) => !have.has(key(t)));
  return [prompt, ...extra].filter(Boolean).join(", ");
}

export function compile(s: PromptState): Compiled {
  const r = RATING_TAGS[s.rating];
  const chars = s.chars
    .filter((c) => c.enabled)
    .map((c) => ({ prompt: joinLines(c.lines), uc: c.uc.trim(), center: c.center }))
    .filter((c) => c.prompt);
  return { base: addMissing(joinLines(s.base), r.add), uc: addMissing(s.uc.trim(), r.uc), chars };
}

/** One prompt string → editor lines; each weighted run becomes its own line. */
export function parseToLines(s: string): Line[] {
  const lines: Line[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) lines.push(newLine(plain.join(", "))); plain = []; };
  for (const tag of splitTags(s)) {
    const m = tag.match(/^(-?[\d.]+)::([\s\S]*?)::?$/);
    if (m) { flush(); lines.push(newLine(m[2].trim(), Number(m[1]))); }
    else plain.push(tag);
  }
  flush();
  return lines.length ? lines : [newLine()];
}
