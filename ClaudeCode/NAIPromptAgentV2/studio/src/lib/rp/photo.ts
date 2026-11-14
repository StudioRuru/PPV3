// Text mode photo messages: `[photo: …]` in a burst becomes a NovelAI render of the character.
import { RATING_TAGS } from "../prompt";
import { parseProfile, photoAppearance, resolveSpice, type RpProfile } from "./profile";
import type { RpStore } from "./store";
import type { RpCharacter, RpMessage, RpSettings } from "./types";

// ponytail: small word list, not a classifier — extend when a tame chat leaks a tag it misses.
const EXPLICIT = /\b(?:nsfw|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vagina|penis|cock|sex|cum|masturbat\w*|explicit)\b/gi;
const ASKS = /\b(?:photo|photos|pic|pics|picture|pictures|selfie|selfies|snap)\b/i;

// ponytail: exact phrase match against the tag vocab — "giant breasts" won't find "gigantic breasts"; an LLM pass if that matters.
/** Real tags found in prose, in reading order; a tag inside a longer found one is dropped. */
function findTags(text: string, vocab: string[]): string[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hits = vocab.map((v) => ({ v, i: t.indexOf(` ${v.toLowerCase()} `) })).filter((h) => h.i >= 0);
  return hits.filter((h) => !hits.some((o) => o.v.length > h.v.length && o.v.includes(h.v))).sort((a, b) => a.i - b.i).map((h) => h.v);
}

/** Appearance tags found in a card's prose, after 1girl/1boy from its gender. */
export function descriptionTags(text: string, vocab: string[]): string {
  const t = text.toLowerCase();
  const girl = /\b(female|woman|girl)\b/.test(t), boy = /\b(male|man|boy)\b/.test(t);
  return [girl ? "1girl" : boy ? "1boy" : "", ...findTags(text, vocab)].filter(Boolean).slice(0, 13).join(", ");
}

const WEAR = new Set(["clothing", "footwear", "nudity"]);
// Bare colours/fabrics (materials) and modifiers like "about to" only mean something next to the tag they modify.
const SKIP_GROUPS = new Set(["materials"]), SKIP = new Set(["about to"]);
const EXPLICIT_1 = new RegExp(EXPLICIT.source, "i");

/**
 * Base look (card beats profile, ensemble speaker's own tags, else tags found in the card's description), then the
 * outfit, then real tags for pose / scene / mood / clothes found in the photo description and recent chat `context`
 * (clothes there replace the card outfit) — the LLM tag pass's tags when it ran, else exact matches — then the model's description.
 */
export function photoPrompt(c: RpCharacter, p: RpProfile | null, speaker: string, desc: string, spice: number, vocab = new Map<string, string>(), context = "", llm?: string[] | null): string {
  const tame = spice < 3;
  const d = tame ? desc.replace(EXPLICIT, "") : desc;
  const appearance = [...vocab].filter(([, g]) => g === "appearance").map(([t]) => t);
  const ctx = (llm?.length ? llm : findTags(`${desc}\n${context}`, [...vocab].filter(([t, g]) => !SKIP_GROUPS.has(g) && !SKIP.has(t)).map(([t]) => t))).filter((t) => !tame || (vocab.get(t) !== "nudity" && !EXPLICIT_1.test(t))).slice(0, 20);
  const outfit = ctx.some((t) => WEAR.has(vocab.get(t)!)) ? "" : c.outfitPrompt;
  const all = [photoAppearance(c, p, speaker || undefined) || descriptionTags(c.description ?? "", appearance), outfit, ...ctx, d, ...(tame ? RATING_TAGS.safe.add : [])]
    .flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
  return [...new Set(all)].join(", ");
}

/** Comma/newline-separated model output → real tags only (weights, underscores, case and junk stripped), deduped, ≤ 20. */
export function cleanTags(raw: string, known: Set<string>): string[] {
  const ts = raw.replace(/^[^:\n]*:/, "").split(/[,\n]/).map((t) => t.toLowerCase().replace(/_/g, " ").replace(/[()[\]{}]|:[\d.]+/g, "").trim());
  return [...new Set(ts.filter((t) => known.has(t)))].slice(0, 20);
}

/** Asks the chat's model for the photo's pose / mood / clothes / scene / framing tags; null when it can't. */
async function llmTags(chat: { model?: string | null }, c: RpCharacter, base: string, context: string, desc: string): Promise<string[] | null> {
  try {
    const { chatStream, heavyGate, isPod } = await import("../llm");
    const { heavyModel } = await import("./server");
    const { knownTags } = require("../tag-index") as typeof import("../tag-index");
    const model = chat.model || c.model || heavyModel();
    const ask = [{ role: "user", content: [
      `Write Danbooru tags for a photo ${c.name} is sending in a chat.`,
      `Their look (already tagged, don't repeat): ${base || "-"}`, `Their usual outfit: ${c.outfitPrompt || "-"}`,
      `Recent chat:\n${context || "-"}`, `The photo: ${desc}`,
      "Output only comma-separated Danbooru tags, at most 20: pose, expression/mood, the clothes worn in this photo (the usual outfit unless the chat changed it), setting/background, camera framing. No hair/eye/body tags, no names, no sentences.",
    ].join("\n\n") }];
    const run = async () => { let out = ""; for await (const t of chatStream("", ask, { model, options: { temperature: 0.2, num_predict: 160 }, system: false, think: false })) out += t; return out; };
    const tags = cleanTags(await (isPod(model) ? run() : heavyGate.run(run)), knownTags());
    return tags.length ? tags : null;
  } catch (e) { console.error("[rp photo tags]", e instanceof Error ? e.message : e); return null; }
}

/** Offer photos only when the user asks, or the last photo is ≥ 8 replies back (or never sent and 8 replies in). */
export function photoDue(history: RpMessage[], lastUser: string): boolean {
  if (ASKS.test(lastUser)) return true;
  // Sent, pending or failed all count: the character believes it sent one.
  const last = history.findLastIndex((m) => m.imageId != null);
  return history.slice(last + 1).filter((m) => m.role === "assistant").length >= 8;
}

/** Renders and links the image; on failure marks the message failed (image_id 0). Returns the rp_images id. */
export async function renderPhoto(store: RpStore, msgId: number, prompt: string, token: string, nsfw: boolean): Promise<number | null> {
  const { generateImage } = await import("../novelai");
  const { DEFAULT_PARAMS } = await import("../nai-body");
  const { saveRpFile } = await import("./server");
  try {
    const { png, seed } = await generateImage({ base: prompt, uc: "", chars: [], rating: nsfw ? "nsfw" : "safe" }, DEFAULT_PARAMS, token);
    return store.setPhoto(msgId, { file: saveRpFile("images", png, "png"), prompt, seed, width: DEFAULT_PARAMS.width, height: DEFAULT_PARAMS.height });
  } catch (e) {
    console.error("[rp photo]", e instanceof Error ? e.message : e);
    store.setPhoto(msgId, null);
    return null;
  }
}

// Every YAML tag → its group (appearance, clothing, poses…); read lazily so the tests don't need the tag files.
const tagVocab = (): Map<string, string> => {
  try { return (require("../tag-index") as typeof import("../tag-index")).yamlGroups(); } catch { return new Map(); }
};

const inFlight = new Set<number>();
/** Renders every photo still pending (image_id -1) in the chat, detached. No token → they fail. */
export function renderPending(store: RpStore, chatId: number, settings: RpSettings, token = process.env.NOVELAI_TOKEN ?? ""): void {
  const chat = store.chat(chatId);
  const c = chat?.characterId != null ? store.character(chat.characterId) : null;
  if (!chat || !c) return;
  const p = parseProfile(c.profile ?? null), spice = resolveSpice(chat, p, settings);
  let vocab: Map<string, string> | null = null;
  const ms = store.messages(chatId);
  for (const [i, m] of ms.entries()) {
    if (m.imageId !== -1 || inFlight.has(m.id)) continue;
    const desc = m.content.match(/^\[photo:\s*(.+?)\s*\]$/i)?.[1] ?? "";
    if (!token || !desc) { store.setPhoto(m.id, null); continue; }
    inFlight.add(m.id);
    vocab ??= tagVocab();
    // ponytail: the last 6 messages only — a change of clothes further back falls back to the card outfit.
    const context = ms.slice(Math.max(0, i - 6), i).filter((x) => x.imageId == null).map((x) => x.content).join("\n");
    const base = photoAppearance(c, p, m.speaker || undefined) || descriptionTags(c.description ?? "", [...vocab].filter(([, g]) => g === "appearance").map(([t]) => t));
    const v = vocab;
    void llmTags(chat, c, base, context, desc)
      .then((llm) => renderPhoto(store, m.id, photoPrompt(c, p, m.speaker, desc, spice, v, context, llm), token, spice >= 3))
      .finally(() => inFlight.delete(m.id));
  }
}
