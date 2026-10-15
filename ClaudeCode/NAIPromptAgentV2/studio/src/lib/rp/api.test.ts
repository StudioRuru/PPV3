import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";
import { RpStore } from "./store";
import { rpFile } from "./files";
import { importCard } from "./import";
import { buildTurn } from "./turn";
import { DEFAULT_RP_SETTINGS } from "./types";
import { toBuffer } from "./voice";

test("rpFile: only avatars/images with a plain image name, inside the rp dir", () => {
  assert.equal(rpFile("/d/rp", "avatars", "a6f1-x.png"), "/d/rp/avatars/a6f1-x.png");
  assert.equal(rpFile("/d/rp", "images", "x.webp"), "/d/rp/images/x.webp");
  assert.equal(rpFile("/d/rp", "images", "../studio.db"), null);
  assert.equal(rpFile("/d/rp", "images", "..%2Fx.png"), null);
  assert.equal(rpFile("/d/rp", "secrets", "x.png"), null);
  assert.equal(rpFile("/d/rp", "images", "x.svg"), null);
});

const card = JSON.stringify({ spec: "chara_card_v2", data: { name: "Mio", first_mes: "Hi", character_book: { entries: [{ keys: ["cafe"], content: "Cats." }] } } });

test("importCard: JSON file → character + embedded lorebook; junk → readable error", async () => {
  const r = await importCard({ file: { name: "mio.json", bytes: Buffer.from(card) } });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.character.name, "Mio"); assert.equal(r.lorebook!.entries.length, 1); assert.equal(r.avatar, null); }
  const bad = await importCard({ file: { name: "x.json", bytes: Buffer.from("{}") } });
  assert.equal(bad.ok, false);
  const none = await importCard({});
  assert.equal(none.ok, false);
  const big = await importCard({ file: { name: "x.png", bytes: Buffer.alloc(9 * 1024 * 1024) } });
  assert.ok(!big.ok && /too big/i.test(big.error));
});

test("importCard: URL must be Chub", async () => {
  const r = await importCard({ url: "https://evil.example/characters/a/b" });
  assert.ok(!r.ok && /chub/i.test(r.error));
});

const store = () => {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY, created_at INTEGER, kind TEXT, tags TEXT, note TEXT, persona TEXT)");
  migrateRp(d);
  return new RpStore(d);
};

test("buildTurn: card, lore, voice lines and story block; model falls back to heavy when the chat's isn't installed", async () => {
  const s = store();
  const lb = s.saveLorebook({ name: "L" });
  s.saveEntry({ lorebookId: lb, keys: ["castle"], content: "CASTLE-LORE" });
  const c = s.saveCharacter({ name: "Mio", description: "A brat.", firstMessage: "Hi", lorebookId: lb, samplerOverrides: JSON.stringify({ temperature: 1.2 }) });
  const v = s.saveVoiceLine({ characterId: c, text: "Hmph." });
  s.setEmbedding(v, toBuffer(new Float32Array([1, 0])), "bge-m3:latest");
  const chat = s.createChat(c);
  s.updateChat(chat, { model: "gone-model:latest" });
  s.append(chat, "user", "to the castle");
  const t = await buildTurn(s, chat, { settings: DEFAULT_RP_SETTINGS, storyBlock: "Likes slow burn.", heavy: "apex", installed: ["apex"], embed: async () => [[1, 0]] });
  const text = t.messages.map((m) => m.content).join("\n");
  assert.match(text, /A brat\./);
  assert.match(text, /CASTLE-LORE/);
  assert.match(text, /Hmph\./);
  assert.match(text, /Likes slow burn\./);
  assert.equal(t.model, "apex");
  assert.equal(t.options.temperature, 1.2);
});

test("buildTurn: regenerate excludes the reply being replaced", async () => {
  const s = store();
  const c = s.saveCharacter({ name: "Mio" });
  const chat = s.createChat(c);
  s.append(chat, "user", "hello");
  const a = s.append(chat, "assistant", "OLD-REPLY")!;
  const t = await buildTurn(s, chat, { settings: DEFAULT_RP_SETTINGS, storyBlock: "", heavy: "apex", installed: [], embed: async () => [] }, a);
  assert.doesNotMatch(t.messages.map((m) => m.content).join("\n"), /OLD-REPLY/);
  assert.equal(t.model, "apex");
});
