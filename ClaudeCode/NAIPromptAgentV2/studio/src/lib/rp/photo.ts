// Text mode photo messages: `[photo: …]` in a burst becomes a NovelAI render of the character.
import { RATING_TAGS } from "../prompt";
import { parseProfile, photoAppearance, resolveSpice, type RpProfile } from "./profile";
import type { RpStore } from "./store";
import type { RpCharacter, RpMessage, RpSettings } from "./types";

// ponytail: small word list, not a classifier — extend when a tame chat leaks a tag it misses.
const EXPLICIT = /\b(?:nsfw|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vagina|penis|cock|sex|cum|masturbat\w*|explicit)\b/gi;
const ASKS = /\b(?:photo|photos|pic|pics|picture|pictures|selfie|selfies|snap)\b/i;

// ponytail: exact phrase match against the appearance vocab — "giant breasts" won't find "gigantic breasts"; an LLM pass if that matters.
/** Real appearance tags found in a card's prose, in reading order; a tag inside a longer found one is dropped. */
export function descriptionTags(text: string, vocab: string[]): string {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hits = vocab.map((v) => ({ v, i: t.indexOf(` ${v.toLowerCase()} `) })).filter((h) => h.i >= 0);
  const keep = hits.filter((h) => !hits.some((o) => o.v.length > h.v.length && o.v.includes(h.v))).sort((a, b) => a.i - b.i).map((h) => h.v);
  const girl = /\b(female|woman|girl)\b/.test(t), boy = /\b(male|man|boy)\b/.test(t);
  return [girl ? "1girl" : boy ? "1boy" : "", ...keep].filter(Boolean).slice(0, 13).join(", ");
}

/** Appearance (card beats profile, ensemble speaker's own tags, else tags found in the card's description), then outfit, then the model's description. */
export function photoPrompt(c: RpCharacter, p: RpProfile | null, speaker: string, desc: string, spice: number, vocab: string[] = []): string {
  const tame = spice < 3;
  const d = tame ? desc.replace(EXPLICIT, "") : desc;
  return [photoAppearance(c, p, speaker || undefined) || descriptionTags(c.description ?? "", vocab), c.outfitPrompt, d, ...(tame ? RATING_TAGS.safe.add : [])]
    .flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean).join(", ");
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

// The YAML appearance group (hair, eyes, body…); read lazily so the tests don't need the tag files.
const appearanceVocab = (): string[] => {
  try {
    const { yamlGroups } = require("../tag-index") as typeof import("../tag-index");
    return [...yamlGroups()].filter(([, g]) => g === "appearance").map(([t]) => t);
  } catch { return []; }
};

const inFlight = new Set<number>();
/** Renders every photo still pending (image_id -1) in the chat, detached. No token → they fail. */
export function renderPending(store: RpStore, chatId: number, settings: RpSettings, token = process.env.NOVELAI_TOKEN ?? ""): void {
  const chat = store.chat(chatId);
  const c = chat?.characterId != null ? store.character(chat.characterId) : null;
  if (!chat || !c) return;
  const p = parseProfile(c.profile ?? null), spice = resolveSpice(chat, p, settings);
  let vocab: string[] | null = null;
  for (const m of store.messages(chatId)) {
    if (m.imageId !== -1 || inFlight.has(m.id)) continue;
    const desc = m.content.match(/^\[photo:\s*(.+?)\s*\]$/i)?.[1] ?? "";
    if (!token || !desc) { store.setPhoto(m.id, null); continue; }
    inFlight.add(m.id);
    vocab ??= appearanceVocab();
    void renderPhoto(store, m.id, photoPrompt(c, p, m.speaker, desc, spice, vocab), token, spice >= 3).finally(() => inFlight.delete(m.id));
  }
}
