import { extractLorebookFromCard, extractPngCardObject, fetchChubCharacter, MAX_CARD_BYTES, parseCardObject, parseLorebookObject, importedToCharacterValues, type ParsedLorebook } from "./cards";
import { readCapped } from "./ingest";
import type { RpCharacter } from "./types";

export type ImportResult =
  | { ok: true; character: Partial<RpCharacter> & { name: string }; lorebook: ParsedLorebook | null; avatar: { bytes: Buffer; ext: string } | null }
  | { ok: false; error: string };

/** A card from an uploaded PNG/JSON file or a Chub link. Nothing is saved here. */
export async function importCard(input: { file?: { name: string; bytes: Buffer }; url?: string }): Promise<ImportResult> {
  if (input.file) {
    const { bytes, name } = input.file;
    if (bytes.length > MAX_CARD_BYTES) return { ok: false, error: "That file is too big for a character card (8 MB max)." };
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    let raw: unknown = null;
    if (isPng) raw = extractPngCardObject(bytes);
    else { try { raw = JSON.parse(bytes.toString("utf8")); } catch { raw = null; } }
    const c = parseCardObject(raw);
    if (!c) return { ok: false, error: isPng ? "That PNG has no character card inside." : `Couldn't read a character card from ${name || "that file"}.` };
    return { ok: true, character: importedToCharacterValues(c, null), lorebook: extractLorebookFromCard(raw), avatar: isPng ? { bytes, ext: "png" } : null };
  }
  if (input.url?.trim()) {
    try {
      const r = await fetchChubCharacter(input.url);
      let avatar: { bytes: Buffer; ext: string } | null = null;
      if (r.avatarUrl) {
        const res = await fetch(r.avatarUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
        const bytes = res?.ok ? await readCapped(res, MAX_CARD_BYTES).catch(() => null) : null;
        const type = res?.headers.get("content-type") ?? "";
        if (bytes?.length && type.startsWith("image/")) avatar = { bytes, ext: type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : "png" };
      }
      return { ok: true, character: importedToCharacterValues(r.imported, null), lorebook: parseLorebookObject(r.embeddedLorebook), avatar };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: "Choose a card file or paste a Chub link." };
}
