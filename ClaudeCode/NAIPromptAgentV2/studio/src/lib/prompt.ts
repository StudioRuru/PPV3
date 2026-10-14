export type Line = { id: string; text: string; weight?: number; enabled: boolean };
/** A character's box on the canvas, as fractions of the image: x/y is its centre (what NovelAI receives). */
export type Region = { x: number; y: number; w: number; h: number };
export type CharBox = { id: string; lines: Line[]; uc: string; center?: { x: number; y: number }; region?: Region; enabled: boolean };
export type Rating = "safe" | "nsfw" | "off";
/** V5 character placement: "ai" lets NovelAI choose; "custom" sends a dot for every character. */
export type Positions = "ai" | "custom";
/** positionWords (default on): Custom mode adds "on the left, full body"… to each character so text and box agree. */
/** artists: the Artists section — sent at the front of the base prompt, each `artist:` tag with its own weight. */
export type PromptState = { base: Line[]; chars: CharBox[]; uc: string; rating: Rating; positions: Positions; positionWords?: boolean; artists?: Line[] };
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
  return { base: [newLine()], chars: [], uc: DEFAULT_UC, rating: "nsfw", positions: "ai" };
}

/** Split on commas/newlines, keeping `w::…::` runs and `{…}` / `[…]` emphasis groups whole. */
export function splitTags(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inWeight = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":" && s[i + 1] === ":") { inWeight = !inWeight; buf += "::"; i++; continue; }
    if (s[i] === "{" || s[i] === "[") depth++;
    if ((s[i] === "}" || s[i] === "]") && depth > 0) depth--;
    if ((s[i] === "," || s[i] === "\n") && !inWeight && !depth) {
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

/** Put tag text into the base or character N (created if missing). Pure: returns a new state. */
export function applyTags(s: PromptState, target: "base" | number, mode: "replace" | "append", text: string): PromptState {
  const put = (lines: Line[]) => (mode === "replace" ? [newLine(text)] : [...lines.filter((l) => l.text.trim()), newLine(text)]);
  if (target === "base") return { ...s, base: put(s.base) };
  const chars = [...s.chars];
  while (chars.length <= target) chars.push({ id: newLine().id, lines: [], uc: "", enabled: true });
  chars[target] = { ...chars[target], lines: put(chars[target].lines) };
  return { ...s, chars };
}

/** Spread unplaced characters left→right across the canvas. */
export function defaultCenter(i: number, n: number): { x: number; y: number } {
  return { x: Math.round(((i + 1) / (n + 1)) * 100) / 100, y: 0.5 };
}

/** True when the user typed something — rating tags alone do not count. */
export function hasContent(s: PromptState): boolean {
  return joinLines(s.base) !== "";
}

/** Old drafts only have a centre dot: give them a default box around it. */
export function regionOf(c: CharBox, i: number, n: number): Region {
  return c.region ?? { ...(c.center ?? defaultCenter(i, n)), w: 0.3, h: 0.6 };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Inside the canvas, at least 8% each way, NaN-proof (pointer maths can produce it on zero-size rects). */
export function clampRegion(r: Region): Region {
  const size = (v: number, d: number) => Math.min(1, Math.max(0.08, Number.isFinite(v) ? v : d));
  const w = size(r.w, 0.3), h = size(r.h, 0.6);
  const pos = (v: number, half: number) => Math.min(1 - half, Math.max(half, Number.isFinite(v) ? v : 0.5));
  return { x: r2(pos(r.x, w / 2)), y: r2(pos(r.y, h / 2)), w: r2(w), h: r2(h) };
}

/** Corner-drag resize: the top-left corner stays put, size is clamped first, then the centre follows. */
export function resizeRegion(from: Region, dx: number, dy: number): Region {
  const left = from.x - from.w / 2, top = from.y - from.h / 2;
  const w = Math.min(1 - left, Math.max(0.08, from.w + dx)), h = Math.min(1 - top, Math.max(0.08, from.h + dy));
  return clampRegion({ x: left + w / 2, y: top + h / 2, w, h });
}

/** Natural-language placement for a box — NovelAI's positions are a nudge that works best reinforced by words. */
export function positionWords(r: Region): string {
  const side = r.x < 0.34 ? "on the left" : r.x > 0.66 ? "on the right" : "in the center";
  const height = r.y < 0.34 ? "upper part of the image" : r.y > 0.66 ? "lower part of the image" : "";
  const area = r.w * r.h;
  const size = r.h >= 0.75 ? "full body" : area >= 0.45 ? "close-up" : area <= 0.05 ? "small in frame, in the distance" : "";
  return [side, height, size].filter(Boolean).join(", ");
}

/** Artist lines → text, each tag carrying the `artist:` prefix NovelAI expects. */
function joinArtists(lines: Line[] = []): string {
  const prefixed = lines.map((l) => ({ ...l, text: splitTags(l.text).map((t) => (/^artist:/i.test(t) ? t : `artist:${t}`)).join(", ") }));
  return joinLines(prefixed);
}

const ARTIST = /^(?:(-?[\d.]+)::)?\s*([{[]*)\s*(artist:[^{}[\]:]+?)\s*[}\]]*\s*(?:::)?$/i;

/** Pull artist tags out of prompt lines (imports, recreate). `{}`/`[]` emphasis becomes a numeric weight (×1.05 per brace). */
export function splitArtists(lines: Line[]): { base: Line[]; artists: Line[] } {
  const artists: Line[] = [];
  const base = lines.map((l) => {
    const keep = splitTags(l.text).filter((t) => {
      const m = t.match(ARTIST);
      if (!m) return true;
      const braces = (m[2].match(/{/g)?.length ?? 0) - (m[2].match(/\[/g)?.length ?? 0);
      const w = m[1] ? Number(m[1]) : braces ? Math.round(1.05 ** braces * 100) / 100 : l.weight;
      artists.push(newLine(m[3].trim(), w === 1 ? undefined : w));
      return false;
    });
    return { ...l, text: keep.join(", ") };
  }).filter((l) => l.text.trim());
  return { base, artists };
}

export function compile(s: PromptState): Compiled {
  const r = RATING_TAGS[s.rating];
  const custom = s.positions === "custom";
  const words = custom && s.positionWords !== false;
  // Default boxes use the full-array index, exactly as the canvas draws them.
  const placed = s.chars.map((c, i) => ({ c, r: regionOf(c, i, s.chars.length) })).filter(({ c }) => c.enabled && joinLines(c.lines));
  // Custom: send left→right so box order never contradicts placement (sort is stable).
  if (custom) placed.sort((a, b) => a.r.x - b.r.x);
  const withWords = (text: string, reg: Region) => {
    const w = words ? positionWords(reg) : "";
    // A recreated recipe already carries its words — don't add them twice.
    return w && !text.toLowerCase().includes(w.toLowerCase()) ? `${text}, ${w}` : text;
  };
  const chars = placed.map(({ c, r: reg }) => ({
    prompt: withWords(joinLines(c.lines), reg),
    uc: c.uc.trim(),
    center: custom ? { x: reg.x, y: reg.y } : undefined,
  }));
  const base = [joinArtists(s.artists), joinLines(s.base)].filter(Boolean).join(", ");
  return { base: addMissing(base, r.add), uc: addMissing(s.uc.trim(), r.uc), chars };
}

/**
 * One prompt string → editor lines. Blank-line sections (how NovelAI's web prompts are laid out) become
 * separate lines; each weighted run becomes its own line; `{{tag,}}` loses the stray comma before its brace.
 */
export function parseToLines(s: string): Line[] {
  const lines: Line[] = [];
  for (const section of s.split(/\n\s*\n/)) {
    let plain: string[] = [];
    const flush = () => { if (plain.length) lines.push(newLine(plain.join(", "))); plain = []; };
    for (const raw of splitTags(section)) {
      const tag = raw.replace(/\s*,\s*([}\]]+)/g, "$1");
      const m = tag.match(/^(-?[\d.]+)::([\s\S]*?)::?$/);
      if (m) { flush(); lines.push(newLine(m[2].trim(), Number(m[1]))); }
      else if (tag) plain.push(tag);
    }
    flush();
  }
  return lines.length ? lines : [newLine()];
}
