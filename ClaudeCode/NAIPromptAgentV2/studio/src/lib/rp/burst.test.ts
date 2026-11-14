import { test } from "node:test";
import assert from "node:assert/strict";
import { burstText, splitBurst, typingMs } from "./burst";

const texts = (raw: string, cast: string[] = []) => splitBurst(raw, cast).bubbles.map((b) => b.text);

test("splitBurst separators", () => {
  assert.deepEqual(texts("a\n---\nb\n---\nc"), ["a", "b", "c"]);
});

test("splitBurst fallback: paragraphs, sentences, cap at 5", () => {
  assert.deepEqual(texts("hey you\n\nwhere are you"), ["hey you", "where are you"]);
  assert.deepEqual(texts("omg. i can't. what?! ok fine."), ["omg.", "i can't.", "what?!", "ok fine."]);
  const nine = Array.from({ length: 9 }, (_, i) => `l${i + 1}`).join("\n");
  const b = texts(nine);
  assert.equal(b.length, 5);
  assert.equal(b[4], "l5\nl6\nl7\nl8\nl9");
});

test("splitBurst reaction", () => {
  const b = splitBurst("[react:😭]\nomg", []);
  assert.equal(b.reaction, "😭");
  assert.deepEqual(b.bubbles.map((x) => x.text), ["omg"]);
  assert.equal(splitBurst("[react:hello]\nomg", []).reaction, "");
  assert.equal(splitBurst("[react:😭😭😭😭😭😭😭😭😭]\nomg", []).reaction, "");
});

test("splitBurst ensemble speakers", () => {
  const b = splitBurst("Rin: hi\n---\nMio: yo\n---\nBob: hey", ["Rin", "Mio"]).bubbles;
  assert.deepEqual(b.map((x) => [x.speaker, x.text]), [["Rin", "hi"], ["Mio", "yo"], ["", "Bob: hey"]]);
  assert.equal(burstText({ bubbles: b, reaction: "" }), "Rin: hi\n---\nMio: yo\n---\nBob: hey");
});

test("typingMs clamps", () => {
  assert.equal(typingMs(""), 600);
  assert.equal(typingMs("x".repeat(200)), 3000);
  assert.equal(typingMs("x".repeat(30)), 1200);
});

test("joinBursts merges a burst into one reply for the model", async () => {
  const { joinBursts } = await import("./burst");
  const row = (id: number, o: object) => ({ id, chatId: 1, role: "assistant", content: "", swipes: [], activeSwipeIndex: 0, createdAt: 0, updatedAt: 0, thought: "", burstId: null, burstSwipes: null, speaker: "", reaction: "", ...o }) as never;
  const take = { bubbles: [{ text: "hi", speaker: "Rin" }, { text: "yo", speaker: "" }], reaction: "" };
  const out = joinBursts([row(1, { role: "user", content: "hey" }), row(2, { content: "hi", speaker: "Rin", burstId: "b", burstSwipes: [take] }), row(3, { content: "yo", burstId: "b" })]);
  assert.deepEqual(out.map((m: { id: number; content: string }) => [m.id, m.content]), [[1, "hey"], [2, "Rin: hi\n---\nyo"]]);
  assert.deepEqual((out[1] as { swipes: string[] }).swipes, ["Rin: hi\n---\nyo"]);
});

test("splitBurst takes a reaction tag at the start of any bubble", () => {
  const b = splitBurst("a puppy??\n---\n[react:😱] omg wait\n---\nok", []);
  assert.equal(b.reaction, "😱");
  assert.deepEqual(b.bubbles.map((x) => x.text), ["a puppy??", "omg wait", "ok"]);
});
