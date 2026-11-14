import type Database from "better-sqlite3";
import type { LoreEntry } from "./prompt";
import { bubbleContent, type Burst } from "./burst";
import { parseProfile } from "./profile";
import { camel, snake, type RpCharacter, type RpChat, type RpMessage, type RpPersona } from "./types";

export type RpLorebook = { id: number; name: string; description: string };
export type RpLoreEntry = LoreEntry & { id: number; lorebookId: number };
export type RpVoiceLine = { id: number; characterId: number; text: string; context: string; source: string; embedding: Buffer | null; embedModel: string };

const parseList = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const parseBursts = (json: unknown): Burst[] | null => { try { const v = JSON.parse(json as string); return Array.isArray(v) ? v : null; } catch { return null; } };
const rowMsg = (r: Record<string, unknown>): RpMessage => ({ ...camel<RpMessage>(r), swipes: parseList(r.swipes as string), burstSwipes: r.burst_swipes ? parseBursts(r.burst_swipes) : null });

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
      // rp_chats.updated_at is the message version, owned by write(): metadata (persona, memory, title…) never moves it,
      // so a background summary or a persona switch can't make the next send 409.
      if (known.has("updated_at") && table !== "rp_chats") row.updated_at = Date.now();
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
      const style = parseProfile(c?.profile ?? null)?.defaults.mode ?? "rp";
      const id = this.upsert("rp_chats", { characterId, personaId: personaId ?? this.persona(null)?.id ?? null, style });
      const greetings = [c?.firstMessage ?? "", ...parseList(c?.alternateGreetings ?? "[]")].filter((g) => g.trim());
      if (greetings.length) this.insertMsg(id, "assistant", greetings[0], greetings.length > 1 ? greetings : []);
      return id;
    })();
  }
  /** Metadata only — doesn't change the chat's version. */
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
    return (this.db.prepare("SELECT m.*, i.file image_file FROM rp_messages m LEFT JOIN rp_images i ON i.id = m.image_id AND m.image_id > 0 WHERE m.chat_id = ? ORDER BY m.id").all(chatId) as Record<string, unknown>[])
      .map(rowMsg);
  }
  version(chatId: number): number | null {
    return (this.db.prepare("SELECT updated_at FROM rp_chats WHERE id = ?").get(chatId) as { updated_at: number } | undefined)?.updated_at ?? null;
  }

  private insertMsg(chatId: number, role: string, content: string, swipes: string[] = [], thought = ""): number {
    const now = Date.now();
    return Number(this.db.prepare("INSERT INTO rp_messages (chat_id, role, content, swipes, active_swipe_index, created_at, updated_at, thought) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
      .run(chatId, role, content, JSON.stringify(swipes), now, now, thought).lastInsertRowid);
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
    return r ? rowMsg(r) : null;
  }
  private setSwipes(msgId: number, swipes: string[], index: number): void {
    this.db.prepare("UPDATE rp_messages SET swipes = ?, active_swipe_index = ?, content = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(swipes), index, swipes[index] ?? "", Date.now(), msgId);
  }

  /** New message id, or null if refused. */
  append(chatId: number, role: "user" | "assistant", content: string, expect?: number, thought = ""): number | null {
    return this.write(chatId, expect, () => this.insertMsg(chatId, role, content, [], thought), null);
  }
  /** Regenerate: add an alternative reply and show it. */
  addSwipe(msgId: number, content: string, expect?: number, thought = ""): boolean {
    const chatId = this.chatOf(msgId);
    if (chatId === null) return false;
    return this.write(chatId, expect, () => {
      const m = this.msg(msgId)!;
      const swipes = m.swipes.length ? [...m.swipes] : [m.content];
      swipes.push(content);
      this.setSwipes(msgId, swipes, swipes.length - 1);
      this.db.prepare("UPDATE rp_messages SET thought = ? WHERE id = ?").run(thought, msgId); // ponytail: latest swipe's thought only
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
  /** Text mode: save a burst as one row per bubble, the reaction on the user message it answers. Ids, or null if refused. */
  appendBurst(chatId: number, burst: Burst, replyTo: number | null, expect?: number, thought = ""): number[] | null {
    return this.write(chatId, expect, () => {
      if (replyTo) this.db.prepare("UPDATE rp_messages SET reaction = ? WHERE id = ? AND chat_id = ?").run(burst.reaction, replyTo, chatId);
      const burstId = crypto.randomUUID();
      const ids = burst.bubbles.map((b, i) => this.insertMsg(chatId, "assistant", bubbleContent(b), [], i ? "" : thought));
      const tag = this.db.prepare("UPDATE rp_messages SET burst_id = ?, speaker = ?, image_id = ? WHERE id = ?");
      ids.forEach((id, i) => tag.run(burstId, burst.bubbles[i].speaker, burst.bubbles[i].photo ? -1 : null, id));
      this.db.prepare("UPDATE rp_messages SET burst_swipes = ? WHERE id = ?").run(JSON.stringify([burst]), ids[0]);
      return ids;
    }, null);
  }
  /** Regenerate the last burst: add a take and show it. */
  replaceBurst(burstId: string, burst: Burst, expect?: number, thought = ""): boolean {
    return this.showBurst(burstId, expect, (takes) => [[...takes, burst], takes.length], thought);
  }
  pickBurst(burstId: string, index: number, expect?: number): boolean {
    return this.showBurst(burstId, expect, (takes) => (Number.isInteger(index) && index >= 0 && index < takes.length ? [takes, index] : null));
  }
  /** Rewrite the last burst's rows to show take `index` (rows added/removed to match), plus its reaction. */
  private showBurst(burstId: string, expect: number | undefined, pick: (takes: Burst[]) => [Burst[], number] | null, thought?: string): boolean {
    const rows = this.db.prepare("SELECT * FROM rp_messages WHERE burst_id = ? ORDER BY id").all(burstId).map((r) => rowMsg(r as Record<string, unknown>));
    if (!rows.length) return false;
    const head = rows[0], chatId = head.chatId;
    return this.write(chatId, expect, () => {
      if (this.db.prepare("SELECT 1 FROM rp_messages WHERE chat_id = ? AND id > ?").get(chatId, rows.at(-1)!.id)) return false; // only the last burst changes
      const got = pick(head.burstSwipes ?? []);
      if (!got) return false;
      const [takes, index] = got, b = takes[index], now = Date.now();
      b.bubbles.forEach((x, i) => {
        // A row showing the same photo keeps its image; a new photo goes back to rendering.
        const c = bubbleContent(x), img = x.photo ? (rows[i]?.content === c ? rows[i].imageId : -1) : null;
        if (rows[i]) this.db.prepare("UPDATE rp_messages SET content = ?, speaker = ?, image_id = ?, updated_at = ? WHERE id = ?").run(c, x.speaker, img, now, rows[i].id);
        else this.db.prepare("UPDATE rp_messages SET burst_id = ?, speaker = ?, image_id = ? WHERE id = ?").run(burstId, x.speaker, img, this.insertMsg(chatId, "assistant", c));
      });
      const gone = rows.slice(b.bubbles.length).map((r) => r.id);
      if (gone.length) {
        const q = gone.map(() => "?").join(",");
        this.db.prepare(`UPDATE rp_images SET message_id = NULL WHERE message_id IN (${q})`).run(...gone);
        this.db.prepare(`DELETE FROM rp_messages WHERE id IN (${q})`).run(...gone);
      }
      this.db.prepare("UPDATE rp_messages SET burst_swipes = ?, active_swipe_index = ? WHERE id = ?").run(JSON.stringify(takes), index, head.id);
      if (thought !== undefined) this.db.prepare("UPDATE rp_messages SET thought = ? WHERE id = ?").run(thought, head.id);
      this.db.prepare("UPDATE rp_messages SET reaction = ? WHERE id = (SELECT MAX(id) FROM rp_messages WHERE chat_id = ? AND id < ? AND role = 'user')").run(b.reaction, chatId, head.id);
      return true;
    }, false);
  }
  /** Links a rendered photo to its message (image_id = the rp_images row), or marks it failed (0). Never moves the chat version. */
  setPhoto(msgId: number, img: { file: string; prompt: string; seed: number; width: number; height: number } | null): number | null {
    const chatId = (this.db.prepare("SELECT chat_id FROM rp_messages WHERE id = ?").get(msgId) as { chat_id: number } | undefined)?.chat_id;
    if (!chatId) return null;
    const id = img ? Number(this.db.prepare("INSERT INTO rp_images (chat_id, message_id, prompt, seed, file, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(chatId, msgId, img.prompt, img.seed, img.file, img.width, img.height).lastInsertRowid) : 0;
    this.db.prepare("UPDATE rp_messages SET image_id = ? WHERE id = ?").run(id, msgId);
    return id || null;
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
