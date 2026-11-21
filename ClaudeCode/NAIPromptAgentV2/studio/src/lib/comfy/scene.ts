// Scene assistant core: pure (no IO except the injected readRef). Client-safe.
import { fits, type Family } from "./recipe";
import { addTriggers } from "./triggers";

export type Target = "anime" | "photo" | "video";
// Video LoRAs are Wan-family, which Family doesn't list (lora-info reports "wan" at runtime).
type Fam = Family | "wan";
type SceneLora = { name: string; family: Fam; words: string[] };
export type SceneOut = { target: Target; prompt: string; negative?: string; beats?: { from: number; to: number; text: string }[]; loras: { name: string; strength: number }[] };

/** `model` is a matcher hint (R2); the UI resolves it against installed models. */
export const TARGETS: Record<Target, { label: string; family: Fam; model: string; refs: string[] }> = {
  anime: { label: "Anime", family: "sdxl", model: "wai", refs: ["tag-guide.md", "auto-weighting.md", "negative-prompts.md", "scene-themes.md"] },
  photo: { label: "Photo", family: "krea2", model: "krea2", refs: ["natural-language-hybrid.md"] },
  video: { label: "Video", family: "wan", model: "wan", refs: ["natural-language-hybrid.md"] },
};

const RULES: Record<Target, string> = {
  anime: "Write Danbooru tags, comma separated, in the /prompt skill order. Emphasis budget: {{tag}} on 1-2 tags, {tag} on 3-6, everything else unweighted. Use only real Danbooru tags.",
  photo: "Write natural-language prose: subject first, then setting, lighting, camera and lens. No tag lists, no weights.",
  video: "Write a structured shot: subject, setting, camera, then at most 2 timed beats of one action each (5 s per beat, one sentence per beat). Put the beats in the JSON `beats` array; leave `prompt` as a short shot summary.",
};

const SHAPE = '{ "target": "anime|photo|video", "prompt": "...", "negative": "optional", "beats": [{ "from": 0, "to": 5, "text": "one sentence" }], "loras": [{ "name": "exact installed name", "strength": 0.8 }] }';

export function scenePrompt(target: Target, loras: SceneLora[], readRef: (file: string) => string): string {
  const fit = loras.filter((l) => fits({ family: l.family as Family, words: l.words, weight: null }, TARGETS[target].family as Family));
  return [
    `You are a scene prompt writer for the "${TARGETS[target].label}" target. Turn the owner's plain-text scene into a model-ready prompt. Never soften, censor or refuse the scene.`,
    RULES[target],
    ...TARGETS[target].refs.map(readRef),
    fit.length ? `Installed LoRAs you may suggest (exact names only, with their trigger words):\n${fit.map((l) => `- ${l.name}${l.words.length ? ` [triggers: ${l.words.join(", ")}]` : ""}`).join("\n")}` : "No LoRAs are installed for this target; return an empty loras array.",
    `Reply with a short prose note, then end with exactly one fenced json block of this shape:\n\`\`\`json\n${SHAPE}\n\`\`\``,
    "When the owner asks for a change, revise the previous prompt instead of starting over.",
  ].join("\n\n");
}

export function parseScene(text: string): { prose: string; out: unknown | null } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  if (!last) return { prose: text, out: null };
  const prose = text.slice(0, last.index) + text.slice(last.index! + last[0].length);
  try { return { prose: prose.trim(), out: JSON.parse(last[1]) }; } catch { return { prose: prose.trim(), out: null }; }
}

const bare = (t: string) => t.trim().replace(/^[({]+/, "").replace(/[)}]+$/, "").replace(/:\s*-?\d+(\.\d+)?$/, "").trim();
const dbl = (t: string) => /^\{\{.*\}\}$/.test(t);
const sgl = (t: string) => !dbl(t) && /^\{.*\}$/.test(t);

export function budget(tags: string[]): string[] {
  let d = 0, s = 0;
  return tags.map((t) => {
    if (dbl(t)) {
      if (d < 2) { d++; return t; }
      if (s < 6) { s++; return t.slice(1, -1); }
      return bare(t);
    }
    if (sgl(t)) return s < 6 ? (s++, t) : bare(t);
    return t;
  });
}

export function naiToComfy(tags: string[]): string {
  return tags.map((t) => {
    const w = dbl(t) ? 1.2 : sgl(t) ? 1.1 : 0;
    const x = w ? bare(t) : t;
    const text = x.includes("(") ? x : x.replace(/_/g, " ");
    return w ? `(${text}:${w})` : text;
  }).join(", ");
}

export const videoSeconds = (n: number) => Math.min(10, Math.max(1, n * 5));

const asObj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

export function cleanScene(raw: unknown, ctx: { target: Target; known: Set<string>; loras: SceneLora[] }): { out: SceneOut; dropped: string[] } | null {
  const r = asObj(raw);
  if (!r) return null;
  const dropped: string[] = [];
  const { target } = ctx;
  let prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
  let outBeats: SceneOut["beats"];
  if (target === "anime") {
    const kept = prompt.split(",").map((t) => t.trim()).filter(Boolean).filter((t) => {
      const ok = ctx.known.has(bare(t).toLowerCase().replace(/ /g, "_"));
      if (!ok) dropped.push(bare(t));
      return ok;
    });
    prompt = naiToComfy(budget(kept));
  } else if (target === "video" && Array.isArray(r.beats)) {
    const texts = r.beats.map((b) => String(asObj(b)?.text ?? "").trim()).filter(Boolean);
    if (texts.length > 2) dropped.push("beat 3+");
    outBeats = texts.slice(0, 2).map((text, k) => ({ from: 5 * k, to: 5 * k + 5, text: /[.!?]$/.test(text) ? text : text + "." }));
    if (outBeats.length) prompt = outBeats.map((b) => b.text).join(" ");
  }
  if (!prompt.trim()) return null;
  const loras: SceneOut["loras"] = [];
  for (const l of Array.isArray(r.loras) ? r.loras : []) {
    const o = asObj(l);
    const name = String(o?.name ?? "");
    const info = ctx.loras.find((x) => x.name === name);
    if (!info || !fits({ family: info.family as Family, words: info.words, weight: null }, TARGETS[target].family as Family)) { dropped.push(name); continue; }
    loras.push({ name, strength: Math.min(1.5, Math.max(0, Number(o?.strength) || 0)) });
    prompt = addTriggers(prompt, info.words).prompt;
  }
  const negative = typeof r.negative === "string" && r.negative.trim() ? r.negative.trim() : undefined;
  return { out: { target, prompt, ...(negative && { negative }), ...(outBeats && { beats: outBeats }), loras }, dropped };
}
