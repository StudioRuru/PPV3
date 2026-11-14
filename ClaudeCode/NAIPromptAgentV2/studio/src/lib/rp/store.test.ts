import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";
import { RpStore } from "./store";

const setup = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY, created_at INTEGER, kind TEXT, tags TEXT, note TEXT, persona TEXT)");
  migrateRp(db);
  const s = new RpStore(db);
  const charId = s.saveCharacter({ name: "Mio", firstMessage: "Hi {{user}}", alternateGreetings: JSON.stringify(["Yo", "Sup"]) });
  return { db, s, charId };
};

test("createChat seeds the greeting, alternate greetings as swipes", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const [m] = s.messages(chatId);
  assert.equal(m.role, "assistant");
  assert.deepEqual(m.swipes, ["Hi {{user}}", "Yo", "Sup"]);
  assert.equal(m.content, "Hi {{user}}");
});

test("addSwipe appends and selects it; pickSwipe switches content; out of range is refused", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  s.append(chatId, "user", "hello");
  const a = s.append(chatId, "assistant", "first")!;
  assert.ok(s.addSwipe(a, "second"));
  let m = s.messages(chatId).at(-1)!;
  assert.deepEqual(m.swipes, ["first", "second"]);
  assert.equal(m.content, "second");
  assert.ok(s.pickSwipe(a, 0));
  assert.equal(s.messages(chatId).at(-1)!.content, "first");
  assert.equal(s.pickSwipe(a, 5), false);
  m = s.messages(chatId).at(-1)!;
  assert.equal(m.activeSwipeIndex, 0);
});

test("edit changes only the active swipe's text", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const [greet] = s.messages(chatId);
  assert.ok(s.pickSwipe(greet.id, 1));
  assert.ok(s.edit(greet.id, "Yo!!"));
  const m = s.messages(chatId)[0];
  assert.deepEqual(m.swipes, ["Hi {{user}}", "Yo!!", "Sup"]);
  assert.equal(m.content, "Yo!!");
});

test("edit on a message with no swipes edits content", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const u = s.append(chatId, "user", "hello")!;
  assert.ok(s.edit(u, "hello there"));
  assert.equal(s.messages(chatId)[1].content, "hello there");
  assert.deepEqual(s.messages(chatId)[1].swipes, []);
});

test("rewind removes only messages after the given one", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const u1 = s.append(chatId, "user", "1")!;
  s.append(chatId, "assistant", "2");
  s.append(chatId, "user", "3");
  assert.ok(s.rewind(chatId, u1));
  assert.deepEqual(s.messages(chatId).map((m) => m.content), ["Hi {{user}}", "1"]);
});

test("a stale version is refused and nothing changes", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const v = s.version(chatId)!;
  assert.ok(s.append(chatId, "user", "a", v));
  assert.equal(s.append(chatId, "user", "b", v), null);
  const last = s.messages(chatId).at(-1)!;
  assert.equal(s.edit(last.id, "zzz", v), false);
  assert.equal(s.rewind(chatId, last.id - 1, v), false);
  assert.deepEqual(s.messages(chatId).map((m) => m.content), ["Hi {{user}}", "a"]);
  assert.ok(s.version(chatId)! > v);
});

test("deleteChat removes its messages; deleteCharacter removes its chats", () => {
  const { db, s, charId } = setup();
  const chatId = s.createChat(charId);
  s.append(chatId, "user", "x");
  s.deleteChat(chatId);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rp_messages").get() as { n: number }).n, 0);
  s.createChat(charId);
  s.deleteCharacter(charId);
  assert.equal(s.chats(charId).length, 0);
  assert.equal(s.character(charId), null);
});

test("saveCharacter updates in place when given an id", () => {
  const { s, charId } = setup();
  assert.equal(s.saveCharacter({ id: charId, name: "Mio 2" }), charId);
  assert.equal(s.character(charId)!.name, "Mio 2");
  assert.equal(s.character(charId)!.firstMessage, "Hi {{user}}");
});

test("loreFor merges character, world and chat lorebooks once, keys parsed", () => {
  const { s, charId } = setup();
  const a = s.saveLorebook({ name: "A" });
  const b = s.saveLorebook({ name: "B" });
  s.saveEntry({ lorebookId: a, keys: ["castle"], content: "A1", enabled: true });
  s.saveEntry({ lorebookId: b, keys: ["moat"], content: "B1", enabled: false });
  s.saveCharacter({ id: charId, name: "Mio", lorebookId: a, worldLorebookId: b });
  const chatId = s.createChat(charId);
  s.updateChat(chatId, { lorebookId: a });
  const lore = s.loreFor(s.chat(chatId)!, s.character(charId));
  assert.deepEqual(lore.map((e) => e.content), ["A1", "B1"]);
  assert.deepEqual(lore[0].keys, ["castle"]);
  assert.equal(lore[1].enabled, false);
});

test("review C1/I3: chat metadata and memory writes never move the message version", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const v = s.version(chatId)!;
  s.updateChat(chatId, { memorySummary: "They met.", summarizedThrough: 1, personaId: null, title: "T" });
  assert.equal(s.version(chatId), v);
  assert.equal(s.chat(chatId)!.memorySummary, "They met.");
  assert.ok(s.append(chatId, "user", "next", v));
});

test("append and addSwipe keep the latest planning thought", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const a = s.append(chatId, "assistant", "first", undefined, "I want to tease.")!;
  assert.equal(s.messages(chatId).find((m) => m.id === a)!.thought, "I want to tease.");
  assert.equal(s.messages(chatId).at(-1)!.thought, "I want to tease.");
  s.append(chatId, "user", "hi");
  assert.equal(s.messages(chatId).at(-1)!.thought, "");
  assert.ok(s.addSwipe(a, "second", undefined, "I'll soften."));
  assert.equal(s.messages(chatId).find((m) => m.id === a)!.thought, "I'll soften.");
});

test("createChat mode from profile: defaults.mode text → text chat; no profile → rp", () => {
  const { s } = setup();
  const t = s.saveCharacter({ name: "Texter", profile: JSON.stringify({ defaults: { mode: "text" } }) });
  const plain = s.saveCharacter({ name: "Plain" });
  assert.equal(s.chat(s.createChat(t))!.style, "text");
  assert.equal(s.chat(s.createChat(plain))!.style, "rp");
});
