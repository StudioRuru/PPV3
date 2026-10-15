// Ported from Delfino Plaza src/lib/card-import.ts; adds a size cap, a Chub host allow-list and V2 export.
import extractChunks from "png-chunks-extract";
import { readCapped } from "./ingest";
import * as pngText from "png-chunk-text";
import type { RpCharacter } from "./types";

/** Cards bigger than this are refused (a real card PNG is well under 8 MB). */
export const MAX_CARD_BYTES = 8 * 1024 * 1024;

/** Normalized character fields ready to hand to createCharacter. */
export interface ImportedCharacter {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  creatorNotes: string;
  tags: string[];
}

/** Map normalized import fields onto column values for createCharacter(). */
export function importedToCharacterValues(
  c: ImportedCharacter,
  avatarPath: string | null,
): Partial<RpCharacter> & { name: string } {
  return {
    name: c.name,
    avatarPath,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    firstMessage: c.firstMessage,
    exampleDialogue: c.exampleDialogue,
    systemPrompt: c.systemPrompt,
    postHistoryInstructions: c.postHistoryInstructions,
    alternateGreetings: JSON.stringify(c.alternateGreetings),
    creatorNotes: c.creatorNotes,
    tags: JSON.stringify(c.tags),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Map a Tavern character-card object (V1 flat, or V2/V3 nested under `data`)
 * to our normalized shape.
 */
export function parseCardObject(raw: unknown): ImportedCharacter | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // V2/V3 nest the fields under `data`; V1 keeps them at the top level.
  const d = (obj.data && typeof obj.data === "object"
    ? (obj.data as Record<string, unknown>)
    : obj) as Record<string, unknown>;

  const name = str(d.name) || str(obj.name);
  if (!name.trim()) return null;

  return {
    name: name.trim(),
    description: str(d.description),
    // Tavern uses `personality`; Chub's native schema also has `tavern_personality`.
    personality: str(d.personality) || str(d.tavern_personality),
    scenario: str(d.scenario),
    // Tavern: first_mes / mes_example. Chub native: first_message / example_dialogs.
    firstMessage: str(d.first_mes) || str(d.first_message),
    exampleDialogue: str(d.mes_example) || str(d.example_dialogs),
    systemPrompt: str(d.system_prompt),
    postHistoryInstructions: str(d.post_history_instructions),
    alternateGreetings: strArray(d.alternate_greetings),
    creatorNotes: str(d.creator_notes),
    tags: strArray(d.tags),
  };
}

/** Parse a plain JSON card export. */
export function parseCardJson(text: string): ImportedCharacter | null {
  if (text.length > MAX_CARD_BYTES) return null;
  try {
    return parseCardObject(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Extract the embedded card JSON object from a Tavern PNG. Tavern stores it in
 * a tEXt chunk keyed `chara` (V2) or `ccv3` (V3), base64-encoded. Prefer V3.
 */
export function extractPngCardObject(buffer: Buffer): unknown {
  if (buffer.length > MAX_CARD_BYTES) return null;
  let chunks;
  try {
    chunks = extractChunks(new Uint8Array(buffer));
  } catch {
    return null;
  }

  const texts = chunks
    .filter((c) => c.name === "tEXt")
    .map((c) => {
      try {
        return pngText.decode(c);
      } catch {
        return null;
      }
    })
    .filter((t): t is { keyword: string; text: string } => t !== null);

  const entry =
    texts.find((t) => t.keyword.toLowerCase() === "ccv3") ??
    texts.find((t) => t.keyword.toLowerCase() === "chara");
  if (!entry) return null;

  try {
    return JSON.parse(Buffer.from(entry.text, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

export function parseCardPng(buffer: Buffer): ImportedCharacter | null {
  return parseCardObject(extractPngCardObject(buffer));
}

/* ------------------------------ lorebook import --------------------------- */

export interface ParsedLorebook {
  name: string;
  entries: {
    keys: string[];
    content: string;
    enabled: boolean;
    insertionOrder: number;
  }[];
}

/** Parse a lorebook/world-info object (Tavern `character_book` or Chub native). */
export function parseLorebookObject(raw: unknown): ParsedLorebook | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawEntries = obj.entries;
  const list: Record<string, unknown>[] = Array.isArray(rawEntries)
    ? (rawEntries as Record<string, unknown>[])
    : rawEntries && typeof rawEntries === "object"
      ? (Object.values(rawEntries) as Record<string, unknown>[])
      : [];

  const entries = list
    .map((e, i) => {
      const keys = strArray(e.keys).length ? strArray(e.keys) : strArray(e.key);
      const order =
        typeof e.insertion_order === "number"
          ? e.insertion_order
          : typeof e.order === "number"
            ? (e.order as number)
            : i;
      return {
        keys,
        content: str(e.content),
        enabled: e.enabled !== false,
        insertionOrder: order,
      };
    })
    .filter((e) => e.content.trim() && e.keys.length > 0);

  if (entries.length === 0) return null;
  return { name: str(obj.name), entries };
}

/** Pull an embedded lorebook out of a character card object, if present. */
export function extractLorebookFromCard(raw: unknown): ParsedLorebook | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data = (obj.data && typeof obj.data === "object" ? obj.data : obj) as Record<
    string,
    unknown
  >;
  return parseLorebookObject(data.character_book ?? data.embedded_lorebook);
}

/* --------------------------------- Chub.ai -------------------------------- */

const CHUB_API = "https://api.chub.ai";
const CHUB_HOSTS = new Set(["chub.ai", "www.chub.ai", "venus.chub.ai", "api.chub.ai", "avatars.charhub.io"]);

/** Only Chub's own https hosts are ever fetched (the avatar URL comes from Chub's reply, so it's checked too). */
export function chubHostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && CHUB_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Extract a Chub `creator/name` fullPath from a pasted URL or raw path.
 * Accepts chub.ai / www.chub.ai / venus.chub.ai links with or without the
 * `/characters/` prefix, and bare `creator/name` strings.
 */
export function extractChubFullPath(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname;
    } catch {
      return null;
    }
  }
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  s = s.replace(/^(characters|character)\//i, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

export interface ChubImportResult {
  imported: ImportedCharacter;
  avatarUrl: string | null;
  /** Chub's embedded lorebook, if any (used by lorebook import later). */
  embeddedLorebook: unknown;
}

/** Map a Chub character `node` (with `.definition`) to normalized fields. */
function parseChubNode(node: Record<string, unknown>): ImportedCharacter | null {
  const def = node?.definition as Record<string, unknown> | undefined;
  if (!def || !str(def.name).trim()) return null;
  const topics = strArray(node.topics);
  return {
    name: str(def.name).trim(),
    description: str(def.description),
    personality: str(def.personality) || str(def.tavern_personality),
    scenario: str(def.scenario),
    firstMessage: str(def.first_message) || str(def.first_mes),
    exampleDialogue: str(def.example_dialogs) || str(def.mes_example),
    systemPrompt: str(def.system_prompt),
    postHistoryInstructions: str(def.post_history_instructions),
    alternateGreetings: strArray(def.alternate_greetings),
    creatorNotes: str(node.tagline),
    tags: topics,
  };
}

/**
 * Fetch a character from Chub by URL/path. Uses the public `?full=true`
 * endpoint, which returns Chub's native definition (no auth for public cards).
 */
export async function fetchChubCharacter(urlOrPath: string): Promise<ChubImportResult> {
  const fullPath = extractChubFullPath(urlOrPath);
  if (!fullPath || (/^https?:/i.test(urlOrPath.trim()) && !chubHostAllowed(urlOrPath.trim()))) {
    throw new Error("That doesn't look like a Chub character link.");
  }

  let res: Response;
  try {
    res = await fetch(`${CHUB_API}/api/characters/${fullPath}?full=true`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Couldn't reach Chub. Check your connection.");
  }

  if (res.status === 404) {
    throw new Error("Character not found on Chub — it may be private or unlisted.");
  }
  if (!res.ok) {
    throw new Error(`Chub returned ${res.status}.`);
  }

  let data: { node?: Record<string, unknown> };
  try {
    data = JSON.parse((await readCapped(res, MAX_CARD_BYTES)).toString("utf8"));
  } catch {
    throw new Error("Chub sent something that isn't a character (or it's too big).");
  }
  const node = (data.node ?? data) as Record<string, unknown>;
  const imported = parseChubNode(node);
  if (!imported) {
    throw new Error("Couldn't read character data from Chub.");
  }

  return {
    imported,
    avatarUrl: typeof node.avatar_url === "string" && chubHostAllowed(node.avatar_url) ? node.avatar_url : null,
    embeddedLorebook: (node.definition as Record<string, unknown>)?.embedded_lorebook ?? null,
  };
}

const list = (json: string) => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Tavern V2 card for export. */
export function toCardV2(c: RpCharacter, lore?: ParsedLorebook | null): object {
  return {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: c.name, description: c.description, personality: c.personality, scenario: c.scenario,
      first_mes: c.firstMessage, mes_example: c.exampleDialogue, system_prompt: c.systemPrompt,
      post_history_instructions: c.postHistoryInstructions, alternate_greetings: list(c.alternateGreetings),
      creator_notes: c.creatorNotes, tags: list(c.tags), creator: "", character_version: "", extensions: {},
      ...(lore ? { character_book: { name: lore.name, entries: lore.entries.map((e, i) => ({ id: i, keys: e.keys, content: e.content, enabled: e.enabled, insertion_order: e.insertionOrder, extensions: {} })), extensions: {} } } : {}),
    },
  };
}
