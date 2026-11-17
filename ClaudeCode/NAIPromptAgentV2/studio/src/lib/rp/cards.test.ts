import { test } from "node:test";
import assert from "node:assert/strict";
import encode from "png-chunks-encode";
import * as pngText from "png-chunk-text";
import { chubHostAllowed, extractChubFullPath, extractLorebookFromCard, parseLorebookObject, MAX_CARD_BYTES, parseCardJson, parseCardObject, parseCardPng, toCardV2 } from "./cards";
import type { RpCharacter } from "./types";

const V2 = {
  spec: "chara_card_v2", spec_version: "2.0",
  data: {
    name: "Mio", description: "A brat.", personality: "smug", scenario: "Cafe", first_mes: "Hi {{user}}", mes_example: "<START>",
    alternate_greetings: ["Yo"], tags: ["tsundere"], creator_notes: "", system_prompt: "", post_history_instructions: "",
    character_book: { name: "Cafe lore", entries: [{ keys: ["cafe"], content: "The cafe is cat-themed.", enabled: true, insertion_order: 1 }] },
  },
};

/** Minimal valid PNG (1×1) with optional tEXt chunks. */
function png(text?: { keyword: string; text: string }): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const chunks: { name: string; data: Uint8Array }[] = [{ name: "IHDR", data: ihdr }];
  if (text) chunks.push(pngText.encode(text.keyword, text.text));
  chunks.push({ name: "IDAT", data: Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]) }, { name: "IEND", data: new Uint8Array() });
  return Buffer.from(encode(chunks));
}

test("V2 JSON maps every field, incl. alternate greetings", () => {
  const c = parseCardJson(JSON.stringify(V2))!;
  assert.equal(c.name, "Mio");
  assert.equal(c.firstMessage, "Hi {{user}}");
  assert.deepEqual(c.alternateGreetings, ["Yo"]);
  assert.deepEqual(c.tags, ["tsundere"]);
});

test("V1 flat JSON is accepted", () => {
  assert.equal(parseCardObject({ name: "Old", first_mes: "hey" })!.firstMessage, "hey");
});

test("PNG with a chara chunk parses; without it, or random bytes, is null", () => {
  const b64 = Buffer.from(JSON.stringify(V2)).toString("base64");
  assert.equal(parseCardPng(png({ keyword: "chara", text: b64 }))!.name, "Mio");
  assert.equal(parseCardPng(png()), null);
  assert.equal(parseCardPng(Buffer.from("not a png at all")), null);
});

test("non-card JSON and oversized input are refused", () => {
  assert.equal(parseCardJson(JSON.stringify({ hello: 1 })), null);
  assert.equal(parseCardJson("{oops"), null);
  assert.equal(parseCardJson(" ".repeat(MAX_CARD_BYTES + 1)), null);
  assert.equal(parseCardPng(Buffer.alloc(MAX_CARD_BYTES + 1)), null);
});

test("embedded character_book becomes a lorebook", () => {
  const lb = extractLorebookFromCard(V2)!;
  assert.equal(lb.name, "Cafe lore");
  assert.deepEqual(lb.entries[0].keys, ["cafe"]);
});

test("Chub paths: links and bare paths parse; only Chub hosts are fetched", () => {
  assert.equal(extractChubFullPath("https://chub.ai/characters/someone/mio-123"), "someone/mio-123");
  assert.equal(extractChubFullPath("someone/mio"), "someone/mio");
  assert.equal(extractChubFullPath("https://chub.ai/"), null);
  assert.equal(chubHostAllowed("https://avatars.charhub.io/a.png"), true);
  assert.equal(chubHostAllowed("https://evil.example/a.png"), false);
  assert.equal(chubHostAllowed("http://127.0.0.1/a.png"), false);
});

test("toCardV2 round-trips through parseCardObject", () => {
  const ch = { name: "Mio", description: "d", personality: "p", scenario: "s", firstMessage: "f", exampleDialogue: "e", systemPrompt: "", postHistoryInstructions: "", alternateGreetings: '["g"]', creatorNotes: "", tags: '["t"]' } as RpCharacter;
  const back = parseCardObject(toCardV2(ch))!;
  assert.equal(back.firstMessage, "f");
  assert.deepEqual(back.alternateGreetings, ["g"]);
  assert.deepEqual(back.tags, ["t"]);
});

test("SillyTavern World Info keeps secondary keys, constant, position, probability, depth; keyless constants survive", () => {
  const wi = { entries: {
    "0": { uid: 0, key: ["Ark"], keysecondary: ["ship"], content: "The Ark is a colony ship.", constant: false, disable: false, order: 50, position: 0, probability: 40, useProbability: true, depth: 6, comment: "Ark" },
    "1": { uid: 1, key: [], content: "Magic is outlawed.", constant: true, disable: true, order: 10, position: 1, probability: 100, useProbability: false },
  } };
  const lb = parseLorebookObject(wi)!;
  assert.equal(lb.entries.length, 2);
  const [a, b] = lb.entries;
  assert.deepEqual([a.keys, a.secondaryKeys, a.constant, a.position, a.probability, a.scanDepth, a.insertionOrder], [["Ark"], ["ship"], false, "before", 40, 6, 50]);
  assert.deepEqual([b.keys, b.constant, b.enabled, b.position, b.probability, b.scanDepth], [[], true, false, "after", 100, undefined]);
  // V2 character_book style
  const v2 = parseLorebookObject({ entries: [{ keys: ["x"], secondary_keys: ["y"], content: "c", position: "before_char", extensions: { depth: 3 } }] })!;
  assert.deepEqual([v2.entries[0].secondaryKeys, v2.entries[0].position], [["y"], "before"]);
});

test("exported character_book round-trips the World Info fields", () => {
  const e = { keys: ["Ark"], secondaryKeys: ["ship"], content: "c", enabled: true, constant: true, position: "before", probability: 40, scanDepth: 6, insertionOrder: 2 };
  const card = toCardV2({ name: "M", alternateGreetings: "[]", tags: "[]" } as RpCharacter, { name: "L", entries: [e] }) as { data: unknown };
  assert.deepEqual(extractLorebookFromCard(card)!.entries[0], e);
});
