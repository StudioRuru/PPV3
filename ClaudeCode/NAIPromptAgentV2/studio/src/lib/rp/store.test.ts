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

test("appendBurst / replaceBurst / pickBurst", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const u = s.append(chatId, "user", "hey")!;
  const a = { bubbles: [{ text: "a1", speaker: "" }, { text: "a2", speaker: "" }], reaction: "😭" };
  const ids = s.appendBurst(chatId, a, u, s.version(chatId)!, "plan")!;
  assert.equal(ids.length, 2);
  let ms = s.messages(chatId);
  const head = ms.find((m) => m.id === ids[0])!;
  assert.ok(head.burstId);
  assert.deepEqual(head.burstSwipes, [a]);
  assert.equal(ms.find((m) => m.id === u)!.reaction, "😭");
  assert.equal(s.appendBurst(chatId, a, u, 1), null, "stale expect refused");

  const b = { bubbles: [{ text: "b1", speaker: "Rin" }, { text: "b2", speaker: "" }, { text: "b3", speaker: "" }], reaction: "" };
  assert.equal(s.replaceBurst(head.burstId!, b, s.version(chatId)!), true);
  ms = s.messages(chatId).filter((m) => m.burstId === head.burstId);
  assert.deepEqual(ms.map((m) => m.content), ["b1", "b2", "b3"]);
  assert.equal(ms[0].speaker, "Rin");
  assert.equal(ms[0].burstSwipes!.length, 2);
  assert.equal(ms[0].activeSwipeIndex, 1);
  assert.equal(s.messages(chatId).find((m) => m.id === u)!.reaction, "");

  assert.equal(s.pickBurst(head.burstId!, 0, s.version(chatId)!), true);
  ms = s.messages(chatId).filter((m) => m.burstId === head.burstId);
  assert.deepEqual(ms.map((m) => m.content), ["a1", "a2"]);
  assert.equal(ms[0].speaker, "");
  assert.equal(s.messages(chatId).find((m) => m.id === u)!.reaction, "😭");
  assert.equal(s.pickBurst(head.burstId!, 5, s.version(chatId)!), false);
  assert.equal(s.pickBurst(head.burstId!, 1, 1), false, "stale expect refused");
  // only the last burst can change: a later message freezes it
  s.append(chatId, "user", "next");
  assert.equal(s.pickBurst(head.burstId!, 1, s.version(chatId)!), false);
});

test("legacy message has no burst", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const m = s.messages(chatId)[0];
  assert.equal(m.burstId, null);
  assert.equal(m.burstSwipes, null);
  assert.equal(m.speaker, "");
  assert.equal(s.pickSwipe(m.id, 1), true);
});

test("burst photo rows: pending, then linked or failed", () => {
  const { s, charId } = setup();
  const chatId = s.createChat(charId);
  const u = s.append(chatId, "user", "pic?")!;
  const ids = s.appendBurst(chatId, { bubbles: [{ text: "ok", speaker: "" }, { text: "", speaker: "", photo: "a selfie" }], reaction: "" }, u)!;
  const row = (id: number) => s.messages(chatId).find((m) => m.id === id)!;
  assert.equal(row(ids[0]).imageId, null);
  assert.equal(row(ids[1]).imageId, -1);
  assert.equal(row(ids[1]).content, "[photo: a selfie]");
  const img = s.setPhoto(ids[1], { file: "x.png", prompt: "p", seed: 1, width: 832, height: 1216 })!;
  assert.ok(img > 0);
  assert.equal(row(ids[1]).imageId, img);
  assert.equal(row(ids[1]).imageFile, "x.png");
  const ids2 = s.appendBurst(chatId, { bubbles: [{ text: "", speaker: "", photo: "b" }], reaction: "" }, null)!;
  assert.equal(s.setPhoto(ids2[0], null), null);
  assert.equal(row(ids2[0]).imageId, 0);
});

test("importLorebook saves a parsed book with every field, in one transaction", () => {
  const { s } = setup();
  const id = s.importLorebook({ name: "Ark", entries: [
    { keys: ["Ark"], secondaryKeys: ["ship"], content: "Colony ship.", enabled: true, constant: false, position: "before", probability: 40, scanDepth: 6, insertionOrder: 5 },
    { keys: [], secondaryKeys: [], content: "No magic.", enabled: false, constant: true, position: "after", probability: 100, insertionOrder: 1 },
  ] }, "fallback");
  const [b, a] = s.entries(id);
  assert.equal(s.lorebooks().find((l) => l.id === id)!.name, "Ark");
  assert.deepEqual([a.secondaryKeys, a.position, a.probability, a.scanDepth], [["ship"], "before", 40, 6]);
  assert.deepEqual([b.constant, b.enabled, b.scanDepth], [true, false, 0]);
  const f = s.importLorebook({ name: " ", entries: [] }, "fallback");
  assert.equal(s.lorebooks().find((l) => l.id === f)!.name, "fallback");
});
