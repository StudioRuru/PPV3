// Text mode photo messages: `[photo: …]` in a burst becomes a NovelAI render of the character.
import { RATING_TAGS } from "../prompt";
import { parseProfile, photoAppearance, resolveSpice, type RpProfile } from "./profile";
import type { RpStore } from "./store";
import type { RpCharacter, RpMessage, RpSettings } from "./types";

// ponytail: small word list, not a classifier — extend when a tame chat leaks a tag it misses.
const EXPLICIT = /\b(?:nsfw|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vagina|penis|cock|sex|cum|masturbat\w*|explicit)\b/gi;
const ASKS = /\b(?:photo|photos|pic|pics|picture|pictures|selfie|selfies|snap)\b/i;

/** Appearance (card beats profile, ensemble speaker's own tags), then outfit, then the model's description. */
export function photoPrompt(c: RpCharacter, p: RpProfile | null, speaker: string, desc: string, spice: number): string {
  const tame = spice < 3;
  const d = tame ? desc.replace(EXPLICIT, "") : desc;
  return [photoAppearance(c, p, speaker || undefined), c.outfitPrompt, d, ...(tame ? RATING_TAGS.safe.add : [])]
    .flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean).join(", ");
}

/** Offer photos only when the user asks, or the last photo is ≥ 8 replies back (or never sent and 8 replies in). */
export function photoDue(history: RpMessage[], lastUser: string): boolean {
  if (ASKS.test(lastUser)) return true;
  const last = history.findLastIndex((m) => (m.imageId ?? 0) > 0);
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

const inFlight = new Set<number>();
/** Renders every photo still pending (image_id -1) in the chat, detached. No token → they fail. */
export function renderPending(store: RpStore, chatId: number, settings: RpSettings, token = process.env.NOVELAI_TOKEN ?? ""): void {
  const chat = store.chat(chatId);
  const c = chat?.characterId != null ? store.character(chat.characterId) : null;
  if (!chat || !c) return;
  const p = parseProfile(c.profile ?? null), spice = resolveSpice(chat, p, settings);
  for (const m of store.messages(chatId)) {
    if (m.imageId !== -1 || inFlight.has(m.id)) continue;
    const desc = m.content.match(/^\[photo:\s*(.+?)\s*\]$/i)?.[1] ?? "";
    if (!token || !desc) { store.setPhoto(m.id, null); continue; }
    inFlight.add(m.id);
    void renderPhoto(store, m.id, photoPrompt(c, p, m.speaker, desc, spice), token, spice >= 3).finally(() => inFlight.delete(m.id));
  }
}
