import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSIONS, cannedLine, outfitFor, parseQuip, pickSprite, readMs, shouldSpeak, type MascotEvent } from "./core";

const S = { now: 100_000, hushUntil: 0, typing: false, lastSpokeAt: 0, cooldownMs: 60_000, inFlight: false };
const ev = (kind: MascotEvent["kind"], at = 100_000, data?: Record<string, unknown>): MascotEvent => ({ kind, at, data });

test("shouldSpeak: basic cooldown", () => {
  assert.equal(shouldSpeak(ev("applied"), S), true);
  assert.equal(shouldSpeak(ev("applied"), { ...S, lastSpokeAt: 70_000 }), false);
});
test("shouldSpeak: priority kinds need half cooldown", () => {
  const s = { ...S, lastSpokeAt: 65_000 }; // 35s ago: >= 30s, < 60s
  assert.equal(shouldSpeak(ev("error"), s), true);
  assert.equal(shouldSpeak(ev("greet"), s), true);
  assert.equal(shouldSpeak(ev("generated", 100_000, { first: true }), s), true);
  assert.equal(shouldSpeak(ev("generated"), s), false);
  assert.equal(shouldSpeak(ev("error"), { ...S, lastSpokeAt: 75_000 }), false);
});
test("shouldSpeak: stale blocks", () => {
  assert.equal(shouldSpeak(ev("error", 100_000 - 30_001), S), false);
  assert.equal(shouldSpeak(ev("error", 100_000 - 30_000), S), true);
});
test("shouldSpeak: hush / typing / inFlight", () => {
  assert.equal(shouldSpeak(ev("applied"), { ...S, hushUntil: 100_001 }), false);
  assert.equal(shouldSpeak(ev("applied"), { ...S, hushUntil: 100_000 }), true);
  assert.equal(shouldSpeak(ev("applied"), { ...S, typing: true }), false);
  assert.equal(shouldSpeak(ev("applied"), { ...S, inFlight: true }), false);
});
test("shouldSpeak: tap always unless inFlight", () => {
  const busy = { ...S, hushUntil: 999_999, typing: true, lastSpokeAt: 99_999 };
  assert.equal(shouldSpeak(ev("tap"), busy), true);
  assert.equal(shouldSpeak(ev("tap"), { ...busy, inFlight: true }), false);
});
test("shouldSpeak: Infinity cooldown only allows tap", () => {
  const s = { ...S, cooldownMs: Infinity };
  assert.equal(shouldSpeak(ev("tap"), s), true);
  assert.equal(shouldSpeak(ev("error"), s), false);
  assert.equal(shouldSpeak(ev("generated", 100_000, { first: true }), s), false);
});

test("parseQuip: tag, no tag, unknown tag", () => {
  assert.deepEqual(parseQuip("[pout] ugh, fine"), { expression: "pout", text: "ugh, fine" });
  assert.deepEqual(parseQuip("hello there"), { expression: "smug", text: "hello there" });
  assert.deepEqual(parseQuip("[grumpy] hm"), { expression: "smug", text: "hm" });
});
test("parseQuip: quotes, prefix, markdown", () => {
  assert.equal(parseQuip('[wink] "nice one"')?.text, "nice one");
  assert.equal(parseQuip("Miyabi: hi")?.text, "hi");
  assert.deepEqual(parseQuip('Miyabi: [laughing] "lol"'), { expression: "laughing", text: "lol" });
  assert.equal(parseQuip("[smug] **wow** _so_ `cool`")?.text, "wow so cool");
});
test("parseQuip: empty -> null, long cut at word", () => {
  assert.equal(parseQuip(""), null);
  assert.equal(parseQuip("  [pout]  "), null);
  const r = parseQuip("[smug] " + "word ".repeat(100))!;
  assert.ok(r.text.length <= 220);
  assert.ok(r.text.endsWith("word"));
});

test("outfitFor: night window wraps midnight", () => {
  const o = { nightFrom: 23, nightTo: 7, pin: null, nsfw: false, flirt: false };
  for (const h of [23, 0, 3, 6]) assert.equal(outfitFor({ ...o, hour: h }), "night");
  for (const h of [7, 12, 22]) assert.equal(outfitFor({ ...o, hour: h }), "day");
});
test("outfitFor: non-wrapping and empty window", () => {
  const o = { pin: null, nsfw: false, flirt: false };
  assert.equal(outfitFor({ ...o, hour: 2, nightFrom: 1, nightTo: 5 }), "night");
  assert.equal(outfitFor({ ...o, hour: 5, nightFrom: 1, nightTo: 5 }), "day");
  assert.equal(outfitFor({ ...o, hour: 3, nightFrom: 4, nightTo: 4 }), "day");
});
test("outfitFor: lewd needs nsfw and flirt; pin overrides", () => {
  const o = { hour: 12, nightFrom: 23, nightTo: 7, pin: null };
  assert.equal(outfitFor({ ...o, nsfw: true, flirt: true }), "lewd");
  assert.equal(outfitFor({ ...o, nsfw: true, flirt: false }), "day");
  assert.equal(outfitFor({ ...o, nsfw: false, flirt: true }), "day");
  assert.equal(outfitFor({ ...o, nsfw: true, flirt: true, pin: "day" }), "day");
  assert.equal(outfitFor({ ...o, nsfw: false, flirt: false, pin: "lewd" }), "lewd");
});
test("outfitFor: flirtyTalk counts as flirt", () => {
  const o = { hour: 12, nightFrom: 23, nightTo: 7, pin: null, nsfw: true, flirt: false };
  assert.equal(outfitFor({ ...o, flirtyTalk: true }), "lewd");
  assert.equal(outfitFor({ ...o, flirtyTalk: false }), "day");
});

test("pickSprite fallback chain", () => {
  assert.equal(pickSprite(new Set(["night/pout", "day/pout"]), "night", "pout"), "night/pout");
  assert.equal(pickSprite(new Set(["day/pout", "night/smug"]), "night", "pout"), "day/pout");
  assert.equal(pickSprite(new Set(["night/smug", "day/smug"]), "night", "pout"), "night/smug");
  assert.equal(pickSprite(new Set(["day/smug"]), "night", "pout"), "day/smug");
  assert.equal(pickSprite(new Set(), "night", "pout"), null);
});

test("cannedLine: >=3 lines per kind, valid, deterministic via rand", () => {
  const kinds: MascotEvent["kind"][] = ["generated", "upscaled", "error", "applied", "prompt_edit", "closet_use", "idle", "greet", "rp_feedback", "rp_chat", "tap"];
  for (const k of kinds) {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const l = cannedLine(k, () => i / 20);
      assert.ok(EXPRESSIONS.includes(l.expression));
      assert.ok(l.text.length > 0 && l.text.length <= 120);
      seen.add(l.text);
    }
    assert.ok(seen.size >= 3, k);
    assert.deepEqual(cannedLine(k, () => 0), cannedLine(k, () => 0));
  }
  assert.ok(cannedLine("tap", () => 0.999999).text);
});

test("readMs: 2.5s + 45ms/char, max 9s", () => {
  assert.equal(readMs(""), 2500);
  assert.equal(readMs("a".repeat(10)), 2950);
  assert.equal(readMs("a".repeat(1000)), 9000);
});

test("parseQuip: markdown/quote-wrapped tags and prefixes", () => {
  assert.deepEqual(parseQuip("**[smug]** nice"), { expression: "smug", text: "nice" });
  assert.deepEqual(parseQuip("*[pout]* ugh"), { expression: "pout", text: "ugh" });
  assert.deepEqual(parseQuip('"[pout] ugh"'), { expression: "pout", text: "ugh" });
  assert.deepEqual(parseQuip("[pout] Miyabi: hi"), { expression: "pout", text: "hi" });
  assert.deepEqual(parseQuip("**Miyabi:** [wink] hey"), { expression: "wink", text: "hey" });
  assert.deepEqual(parseQuip("Miyabi - [wink] hey"), { expression: "wink", text: "hey" });
  assert.deepEqual(parseQuip("[Smug] hi"), { expression: "smug", text: "hi" });
});
test("parseQuip: first non-empty line only", () => {
  assert.deepEqual(parseQuip("[smug] Nice.\n(She smirks.)"), { expression: "smug", text: "Nice." });
  assert.deepEqual(parseQuip("[pout]\n\nugh\nmore"), { expression: "pout", text: "ugh" });
});
test("parseQuip: paired emphasis only", () => {
  assert.equal(parseQuip("use snake_case and #1 ok~")?.text, "use snake_case and #1 ok~");
  assert.equal(parseQuip("# *hey* **you**")?.text, "hey you");
  assert.equal(parseQuip("> hi")?.text, "hi");
});
test("parseQuip: cut landing on a space keeps the word", () => {
  const r = parseQuip("a".repeat(219) + " bbb")!;
  assert.equal(r.text, "a".repeat(219));
  const r2 = parseQuip("a".repeat(215) + " bbbb cc")!;
  assert.equal(r2.text, "a".repeat(215) + " bbbb");
});

test("parseQuip: leftover closers around the tag", () => {
  assert.deepEqual(parseQuip("Miyabi: **[smug]** hi"), { expression: "smug", text: "hi" });
  assert.deepEqual(parseQuip("**[smug] nice**"), { expression: "smug", text: "nice" });
  assert.deepEqual(parseQuip("[smug]**  hi"), { expression: "smug", text: "hi" });
  assert.equal(parseQuip("[smug] `hi`")?.text, "hi");
});
test("parseQuip: Miyabi- names are kept", () => {
  assert.equal(parseQuip("Miyabi-chan is here")?.text, "Miyabi-chan is here");
  assert.equal(parseQuip("[smug] Miyabi-chan says hi")?.text, "Miyabi-chan says hi");
  assert.equal(parseQuip("Miyabi：hi")?.text, "hi");
  assert.equal(parseQuip("Miyabi — hi")?.text, "hi");
  assert.equal(parseQuip("Miyabi - hi")?.text, "hi");
});
