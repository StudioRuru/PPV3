import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";
import { RpStore } from "./store";
import { rpFile } from "./files";
import { importCard } from "./import";
import { buildTurn, openingKind, steerTurn } from "./turn";
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
  assert.ok(!t.messages.some((m) => m.role === "assistant" && /OLD-REPLY/.test(m.content))); // only in the "avoid" note
  assert.equal(t.model, "apex");
});

test("buildTurn: per-chat mods reach the prompt, and the chat's reply length sets the token cap", async () => {
  const s = store();
  const c = s.saveCharacter({ name: "Mio" });
  const chat = s.createChat(c);
  s.updateChat(chat, { replyLength: 4, mods: JSON.stringify({ bimbofication: { enabled: true, value: 10 }, hypnosis: { enabled: true, value: 9 } }) });
  s.append(chat, "user", "hi");
  const t = await buildTurn(s, chat, { settings: { ...DEFAULT_RP_SETTINGS, replyLength: 1 }, storyBlock: "", heavy: "apex", installed: [], embed: async () => [] });
  const text = t.messages.map((m) => m.content).join("\n");
  assert.match(text, /Mio is a total bimbo \(100% bimbofied\)/);
  assert.match(text, /totally entranced \(hypnosis level 9\/10\)/);
  assert.equal(t.options.num_predict, 1600);
});

test("buildTurn: global mods apply to untuned chats; a tuned chat's map wins", async () => {
  const s = store();
  const c = s.saveCharacter({ name: "Mio" });
  const deps = { settings: { ...DEFAULT_RP_SETTINGS, mods: JSON.stringify({ hypnosis: { enabled: true, value: 9 } }) }, storyBlock: "", heavy: "apex", installed: [], embed: async () => [] };
  const untuned = s.createChat(c);
  s.append(untuned, "user", "hi");
  assert.match((await buildTurn(s, untuned, deps)).messages.map((m) => m.content).join("\n"), /hypnosis level 9\/10/);
  const tuned = s.createChat(c);
  s.updateChat(tuned, { mods: JSON.stringify({ hypnosis: { enabled: false, value: 9 } }) });
  s.append(tuned, "user", "hi");
  assert.doesNotMatch((await buildTurn(s, tuned, deps)).messages.map((m) => m.content).join("\n"), /hypnosis/i);
});

test("regenerate: earlier drafts are shown to avoid, sampler gets hotter per retry, wild goes further", async () => {
  const s = store();
  const c = s.saveCharacter({ name: "Mio" });
  const chat = s.createChat(c);
  s.append(chat, "user", "hello");
  const a = s.append(chat, "assistant", "FIRST-DRAFT")!;
  const deps = { settings: { ...DEFAULT_RP_SETTINGS, temperature: 1 }, storyBlock: "", heavy: "apex", installed: [], embed: async () => [] };
  const t = await buildTurn(s, chat, deps, a);
  assert.match(t.messages.at(-1)!.content, /Alternate take[\s\S]*FIRST-DRAFT/);
  assert.ok(t.options.temperature! > 1 && t.options.seed !== undefined);
  s.addSwipe(a, "SECOND-DRAFT");
  const t2 = await buildTurn(s, chat, deps, a);
  assert.ok(t2.options.temperature! > t.options.temperature!);
  const w = steerTurn({ ...t, messages: [] }, { drafts: ["x"], wild: true, spice: 2, charName: "Mio", userName: "Kai" }, () => 0);
  assert.ok(w.options.temperature! >= 1.5 && w.options.min_p! >= 0.08);
  assert.match(w.messages[0].content, /surprising turn/);
  const fresh = await buildTurn(s, chat, deps); // a normal turn: fresh seed + "keep it fresh", sampler heat untouched
  assert.ok(fresh.options.seed !== undefined && fresh.options.temperature === 1);
  assert.match(fresh.messages.at(-1)!.content, /Keep it fresh/);
});

test("steerTurn: spice gates adult directions; the opening differs from the last reply's", () => {
  const t = { messages: [], options: {}, model: "m", truncated: false };
  const dirs = (spice: number) => new Set(Array.from({ length: 400 }, (_, i) => {
    let n = i; const r = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    return steerTurn(t, { drafts: ["x"], spice, charName: "Mio", userName: "Kai" }, r).messages[0].content.match(/Direction: (.*)/)![1];
  }));
  assert.ok(![...dirs(0)].some((d) => /flirt|desire|explicit|seduction/i.test(d)));
  assert.ok([...dirs(3)].some((d) => /explicit/i.test(d)));
  assert.equal(openingKind('"Hi."'), "dialogue");
  for (let i = 0; i < 20; i++) {
    const c = steerTurn(t, { recent: ['"Hey," she said.'], spice: 2, charName: "Mio", userName: "Kai" }).messages[0].content;
    assert.doesNotMatch(c, /Open with a line of Mio's dialogue/);
  }
});

test("chat style: texting writes only texts and drops the card's POV lock; story narrates; steering follows", async () => {
  const s = store();
  const c = s.saveCharacter({ name: "Mio", povMode: "second" });
  const chat = s.createChat(c);
  s.append(chat, "user", "hey you");
  const deps = { settings: DEFAULT_RP_SETTINGS, storyBlock: "", heavy: "apex", installed: [], embed: async () => [] };
  const text = async () => (await buildTurn(s, chat, deps)).messages.map((m) => m.content).join("\n");
  assert.match(await text(), /second person/);
  s.updateChat(chat, { style: "chat" });
  const t = await text();
  assert.match(t, /Style: texting/);
  assert.doesNotMatch(t, /second person/);
  assert.match(t, /Write only Mio's texts/);
  assert.match(t, /Send [^.]*texts?/); // length counts texts, not paragraphs
  assert.doesNotMatch(t, /paragraph/);
  s.updateChat(chat, { style: "story" });
  assert.match(await text(), /narrated story[\s\S]*Keep narrating in the third person/);
});
