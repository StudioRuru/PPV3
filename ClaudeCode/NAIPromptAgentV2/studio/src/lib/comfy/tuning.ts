// Client-safe (CopilotPanel imports it): no server-only imports. The real model call is injected via `deps.complete`.
import { family, type PhotoRecipe } from "./recipe";
import { addTriggers } from "./triggers";

export type RuleId = "face" | "plastic" | "hands" | "strong" | "pose" | "blurry";
export const CHIPS: { id: RuleId; label: string }[] = [
  { id: "face", label: "face drifted" }, { id: "plastic", label: "too plastic" }, { id: "hands", label: "bad hands" },
  { id: "strong", label: "LoRA too strong" }, { id: "pose", label: "wrong pose" }, { id: "blurry", label: "blurry" },
];
const RULES: [RuleId, RegExp][] = [
  ["face", /face|drift|identity|look(s)? different/i], ["plastic", /plastic|waxy|smooth|cgi|fake/i], ["hands", /hand|finger/i],
  ["strong", /too strong|overcook|burn|fried|lora/i], ["pose", /pose|position|angle/i], ["blurry", /blur|soft|mushy|out of focus/i],
];
export const matchRule = (text: string): RuleId | null => RULES.find(([, re]) => re.test(text))?.[0] ?? null;

const q = (x: number) => +(Math.round(x * 20) / 20).toFixed(2);
const more = (steps: number) => Math.min(60, Math.round(steps * 1.25));

export function rulePatch(id: RuleId, r: PhotoRecipe): { patch: Partial<PhotoRecipe>; change: string } {
  switch (id) {
    case "face":
      if (!r.loras.length) return { patch: { faceFix: true }, change: "turn on face fix" };
      return {
        patch: { loras: r.loras.map((l, i) => ({ ...l, strength: q(i === 0 ? Math.min(1.2, l.strength + 0.15) : Math.max(0.3, l.strength - 0.15)) })) },
        change: `raise ${r.loras[0].name} and ease the other LoRAs`,
      };
    case "plastic": {
      const cfg = Math.max(1, +(r.cfg - (family(r.model) === "sdxl" ? 1 : 0.5)).toFixed(2));
      return { patch: { cfg, prompt: addTriggers(r.prompt, ["natural skin texture", "film grain"]).prompt }, change: `lower cfg to ${cfg} and add natural skin texture, film grain to the prompt` };
    }
    case "hands": return { patch: { steps: more(r.steps) }, change: `raise steps to ${more(r.steps)}` };
    case "strong": return { patch: { loras: r.loras.map((l) => ({ ...l, strength: Math.max(0.05, q(l.strength * 0.75)) })) }, change: "turn every LoRA down by a quarter" };
    case "pose": return { patch: { seed: -1 }, change: "roll a fresh seed" };
    case "blurry": {
      const patch: Partial<PhotoRecipe> = { steps: more(r.steps) };
      if (!r.hires) patch.hires = { scale: 1.5, denoise: 0.35 };
      return { patch, change: `raise steps to ${patch.steps}${patch.hires ? " and add a 1.5x hires pass" : ""}` };
    }
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Only allowed fields, never `model`; numbers finite and clamped to the recipe validator's bounds; LoRAs: strength of names already in the stack, nothing added or removed. */
export function safePatch(r: PhotoRecipe, p: Partial<PhotoRecipe>): Partial<PhotoRecipe> {
  const out: Record<string, unknown> = {};
  const src = p as Record<string, unknown>;
  if (fin(src.steps)) out.steps = clamp(Math.round(src.steps), 1, 60);
  if (fin(src.cfg)) out.cfg = clamp(src.cfg, 1, 30);
  if (fin(src.seed)) out.seed = src.seed === -1 ? -1 : clamp(Math.round(src.seed), 0, 0xffffffff);
  for (const k of ["width", "height"]) if (fin(src[k])) out[k] = clamp(Math.round((src[k] as number) / 64) * 64, 512, 2048);
  for (const k of ["prompt", "sampler", "scheduler"]) if (typeof src[k] === "string") out[k] = src[k];
  if (typeof src.faceFix === "boolean") out.faceFix = src.faceFix;
  const h = src.hires as { scale?: unknown; denoise?: unknown } | null | undefined;
  if (h === null) out.hires = null;
  else if (h && fin(h.scale) && fin(h.denoise)) out.hires = { scale: clamp(h.scale, 1, 2), denoise: clamp(h.denoise, 0, 1) };
  if (Array.isArray(p.loras)) {
    const by = new Map(p.loras.map((l) => [l?.name, l?.strength]));
    out.loras = r.loras.map((l) => { const s = by.get(l.name); return fin(s) ? { ...l, strength: clamp(s, 0.05, 2) } : l; });
  }
  return out as Partial<PhotoRecipe>;
}

export type Suggestion = { say: string; rule: RuleId | null; patch: Partial<PhotoRecipe> };
export async function suggest(
  body: { chip?: RuleId; text?: string; recipe: PhotoRecipe },
  deps: { complete: (system: string, user: string) => Promise<string> },
): Promise<Suggestion> {
  const rule = body.chip ?? (body.text ? matchRule(body.text) : null);
  const fix = rule ? rulePatch(rule, body.recipe) : null;
  const said = body.text?.trim() || CHIPS.find((c) => c.id === rule)?.label || "";
  const ask = fix ? `In one or two short sentences, react to what the owner said and explain this change: ${fix.change}. No tags, no lists.` : "In one or two short sentences, answer what the owner said. No tags, no lists.";
  let say: string;
  try { say = (await deps.complete(ask, said)).trim(); if (!say) throw new Error("empty"); }
  catch { say = fix ? `Hmph, my brain's napping~ Try this: ${fix.change}` : "Hmph, my brain's napping~ Ask me again in a bit."; }
  return { say, rule, patch: fix?.patch ?? {} };
}
