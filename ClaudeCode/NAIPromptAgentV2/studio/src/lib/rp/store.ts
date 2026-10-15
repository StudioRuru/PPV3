import type Database from "better-sqlite3";
import type { LoreEntry } from "./prompt";
import { camel, snake, type RpCharacter, type RpChat, type RpMessage, type RpPersona } from "./types";

export type RpLorebook = { id: number; name: string; description: string };
export type RpLoreEntry = LoreEntry & { id: number; lorebookId: number };
export type RpVoiceLine = { id: number; characterId: number; text: string; context: string; source: string; embedding: Buffer | null; embedModel: string };

const parseList = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

/** All RP reads/writes. Chat writes take an optional `expect` version (the chat's updated_at) and refuse stale ones. */
export class RpStore {
  private cols = new Map<string, Set<string>>();
  constructor(private db: Database.Database) {}

  /** Insert or update a row from a camelCase object, using only real columns of the table. */
  private upsert(table: string, obj: Record<string, unknown>): number {
    if (!this.cols.has(table)) this.cols.set(table, new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)));
    const known = this.cols.get(table)!;
    const row = Object.fromEntries(Object.entries(snake(obj)).filter(([k]) => known.has(k) && k !== "id" && k !== "created_at"));
    const id = obj.id as number | undefined;
    if (id) {
      if (known.has("updated_at")) row.updated_at = Date.now();
      const keys = Object.keys(row);
      if (keys.length) this.db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...row, id });
      return id;
    }
    const keys = Object.keys(row);
    const sql = keys.length ? `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})` : `INSERT INTO ${table} DEFAULT VALUES`;
    return Number(this.db.prepare(sql).run(row).lastInsertRowid);
  }

  // Characters
  characters(): RpCharacter[] {
    return (this.db.prepare("SELECT * FROM rp_characters ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map((r) => camel<RpCharacter>(r));
  }
  character(id: number): RpCharacter | null {
    const r = this.db.prepare("SELECT * FROM rp_characters WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? camel<RpCharacter>(r) : null;
  }
  saveCharacter(c: Partial<RpCharacter> & { name: string }): number {
    return this.upsert("rp_characters", c);
  }
  /** Deletes the character, its chats (cascade) and voice lines; returns files (avatar + chat images) no longer referenced. */
  deleteCharacter(id: number): string[] {
    const c = this.character(id);
    const imgs = (this.db.prepare("SELECT i.file FROM rp_images i JOIN rp_chats c ON c.id = i.chat_id WHERE c.character_id = ?").all(id) as { file: string }[]).map((r) => r.file);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM rp_images WHERE chat_id IN (SELECT id FROM rp_chats WHERE character_id = ?)").run(id);
      this.db.prepare("DELETE FROM rp_characters WHERE id = ?").run(id);
    })();
    return [...(c?.avatarPath ? [c.avatarPath] : []), ...imgs];
  }

  // Personas
  personas(): RpPersona[] {
    return (this.db.prepare("SELECT * FROM rp_personas ORDER BY is_default DESC, id").all() as Record<string, unknown>[]).map((r) => camel<RpPersona>(r));
  }
  persona(id: number | null): RpPersona | null {
    const r = (id ? this.db.prepare("SELECT * FROM rp_personas WHERE id = ?").get(id) : this.db.prepare("SELECT * FROM rp_personas ORDER BY is_default DESC, id LIMIT 1").get()) as Record<string, unknown> | undefined;
    return r ? camel<RpPersona>(r) : null;
  }
  savePersona(p: Partial<RpPersona> & { name: string }): number {
    return this.upsert("rp_personas", p);
  }

  // Lorebooks
  lorebooks(): RpLorebook[] {
    return this.db.prepare("SELECT id, name, description FROM rp_lorebooks ORDER BY name").all() as RpLorebook[];
  }
  entries(lorebookId: number): RpLoreEntry[] {
    return (this.db.prepare("SELECT * FROM rp_lore_entries WHERE lorebook_id = ? ORDER BY insertion_order, id").all(lorebookId) as Record<string, unknown>[]).map((r) => {
      const e = camel<Record<string, unknown>>(r);
      return { ...e, keys: parseList(e.keys as string), secondaryKeys: parseList(e.secondaryKeys as string), enabled: !!e.enabled, constant: !!e.constant } as RpLoreEntry;
    });
  }
  saveLorebook(l: Partial<RpLorebook> & { name: string }): number {
    return this.upsert("rp_lorebooks", l);
  }
  deleteLorebook(id: number): void {
    this.db.prepare("DELETE FROM rp_lorebooks WHERE id = ?").run(id);
  }
  saveEntry(e: Partial<RpLoreEntry> & { lorebookId: number }): number {
    const row: Record<string, unknown> = { ...e };
    if (e.keys) row.keys = JSON.stringify(e.keys);
    if (e.secondaryKeys) row.secondaryKeys = JSON.stringify(e.secondaryKeys);
    if (e.enabled !== undefined) row.enabled = e.enabled ? 1 : 0;
    if (e.constant !== undefined) row.constant = e.constant ? 1 : 0;
    return this.upsert("rp_lore_entries", row);
  }
  deleteEntry(id: number): void {
    this.db.prepare("DELETE FROM rp_lore_entries WHERE id = ?").run(id);
  }
  /** Entries active for a chat: the character's lorebook, its world lorebook and the chat's own, de-duplicated. */
  loreFor(chat: RpChat, character: RpCharacter | null): LoreEntry[] {
    const ids = [...new Set([character?.lorebookId, character?.worldLorebookId, chat.lorebookId].filter((x): x is number => !!x))];
    return ids.flatMap((id) => this.entries(id));
  }

  // Voice lines
  voiceLines(characterId: number): RpVoiceLine[] {
    return (this.db.prepare("SELECT * FROM rp_voice_lines WHERE character_id = ? ORDER BY id").all(characterId) as Record<string, unknown>[]).map((r) => camel<RpVoiceLine>(r));
  }
  saveVoiceLine(v: Partial<RpVoiceLine> & { characterId: number; text: string }): number {
    // Changed text invalidates the vector.
    return this.upsert("rp_voice_lines", v.id && v.embedding === undefined ? { ...v, embedding: null, embedModel: "" } : v);
  }
  setEmbedding(id: number, embedding: Buffer, model: string): void {
    this.db.prepare("UPDATE rp_voice_lines SET embedding = ?, embed_model = ? WHERE id = ?").run(embedding, model, id);
  }
  deleteVoiceLine(id: number): void {
    this.db.prepare("DELETE FROM rp_voice_lines WHERE id = ?").run(id);
  }

  // Chats
  chats(characterId: number): RpChat[] {
    return (this.db.prepare("SELECT * FROM rp_chats WHERE character_id = ? ORDER BY updated_at DESC").all(characterId) as Record<string, unknown>[]).map((r) => camel<RpChat>(r));
  }
  chat(id: number): RpChat | null {
    const r = this.db.prepare("SELECT * FROM rp_chats WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? camel<RpChat>(r) : null;
  }
  /** New chat opened by the character's greeting (alternate greetings become swipes). */
  createChat(characterId: number, personaId?: number | null): number {
    const c = this.character(characterId);
    return this.db.transaction(() => {
      const id = this.upsert("rp_chats", { characterId, personaId: personaId ?? this.persona(null)?.id ?? null });
      const greetings = [c?.firstMessage ?? "", ...parseList(c?.alternateGreetings ?? "[]")].filter((g) => g.trim());
      if (greetings.length) this.insertMsg(id, "assistant", greetings[0], greetings.length > 1 ? greetings : []);
      return id;
    })();
  }
  updateChat(id: number, patch: Partial<RpChat>): void {
    this.upsert("rp_chats", { ...patch, id });
  }
  deleteChat(id: number): string[] {
    const imgs = (this.db.prepare("SELECT file FROM rp_images WHERE chat_id = ?").all(id) as { file: string }[]).map((r) => r.file);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM rp_images WHERE chat_id = ?").run(id);
      this.db.prepare("DELETE FROM rp_chats WHERE id = ?").run(id);
    })();
    return imgs;
  }

  messages(chatId: number): RpMessage[] {
    return (this.db.prepare("SELECT * FROM rp_messages WHERE chat_id = ? ORDER BY id").all(chatId) as Record<string, unknown>[])
      .map((r) => ({ ...camel<RpMessage>(r), swipes: parseList(r.swipes as string) }));
  }
  version(chatId: number): number | null {
    return (this.db.prepare("SELECT updated_at FROM rp_chats WHERE id = ?").get(chatId) as { updated_at: number } | undefined)?.updated_at ?? null;
  }

  private insertMsg(chatId: number, role: string, content: string, swipes: string[] = []): number {
    const now = Date.now();
    return Number(this.db.prepare("INSERT INTO rp_messages (chat_id, role, content, swipes, active_swipe_index, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .run(chatId, role, content, JSON.stringify(swipes), now, now).lastInsertRowid);
  }
  /** Run `fn` in a transaction if the chat exists and matches `expect`; bumps the version strictly. */
  private write<T>(chatId: number, expect: number | undefined, fn: () => T, refused: T): T {
    return this.db.transaction(() => {
      const v = this.version(chatId);
      if (v === null || (expect !== undefined && v !== expect)) return refused;
      const out = fn();
      if (out === refused) return refused;
      this.db.prepare("UPDATE rp_chats SET updated_at = ? WHERE id = ?").run(Math.max(Date.now(), v + 1), chatId);
      return out;
    })();
  }
  private chatOf(msgId: number): number | null {
    return (this.db.prepare("SELECT chat_id FROM rp_messages WHERE id = ?").get(msgId) as { chat_id: number } | undefined)?.chat_id ?? null;
  }
  private msg(msgId: number): RpMessage | null {
    const r = this.db.prepare("SELECT * FROM rp_messages WHERE id = ?").get(msgId) as Record<string, unknown> | undefined;
    return r ? { ...camel<RpMessage>(r), swipes: parseList(r.swipes as string) } : null;
  }
  private setSwipes(msgId: number, swipes: string[], index: number): void {
    this.db.prepare("UPDATE rp_messages SET swipes = ?, active_swipe_index = ?, content = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(swipes), index, swipes[index] ?? "", Date.now(), msgId);
  }

  /** New message id, or null if refused. */
  append(chatId: number, role: "user" | "assistant", content: string, expect?: number): number | null {
    return this.write(chatId, expect, () => this.insertMsg(chatId, role, content), null);
  }
  /** Regenerate: add an alternative reply and show it. */
  addSwipe(msgId: number, content: string, expect?: number): boolean {
    const chatId = this.chatOf(msgId);
    if (chatId === null) return false;
    return this.write(chatId, expect, () => {
      const m = this.msg(msgId)!;
      const swipes = m.swipes.length ? [...m.swipes] : [m.content];
      swipes.push(content);
      this.setSwipes(msgId, swipes, swipes.length - 1);
      return true;
    }, false);
  }
  pickSwipe(msgId: number, index: number, expect?: number): boolean {
    const chatId = this.chatOf(msgId);
    if (chatId === null) return false;
    return this.write(chatId, expect, () => {
      const m = this.msg(msgId)!;
      if (!Number.isInteger(index) || index < 0 || index >= m.swipes.length) return false;
      this.setSwipes(msgId, m.swipes, index);
      return true;
    }, false);
  }
  edit(msgId: number, content: string, expect?: number): boolean {
    const chatId = this.chatOf(msgId);
    if (chatId === null) return false;
    return this.write(chatId, expect, () => {
      const m = this.msg(msgId)!;
      if (!m.swipes.length) {
        this.db.prepare("UPDATE rp_messages SET content = ?, updated_at = ? WHERE id = ?").run(content, Date.now(), msgId);
        return true;
      }
      const swipes = [...m.swipes];
      swipes[m.activeSwipeIndex] = content;
      this.setSwipes(msgId, swipes, m.activeSwipeIndex);
      return true;
    }, false);
  }
  /** Delete every message after `afterMsgId` in the chat. */
  rewind(chatId: number, afterMsgId: number, expect?: number): boolean {
    return this.write(chatId, expect, () => {
      this.db.prepare("UPDATE rp_images SET message_id = NULL WHERE message_id IN (SELECT id FROM rp_messages WHERE chat_id = ? AND id > ?)").run(chatId, afterMsgId);
      this.db.prepare("DELETE FROM rp_messages WHERE chat_id = ? AND id > ?").run(chatId, afterMsgId);
      return true;
    }, false);
  }
}
