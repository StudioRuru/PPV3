import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRp } from "./schema";
import { RpStore } from "./store";
import { embedVoiceLines, rankVoiceLines, selectVoiceLines, toBuffer, toVector } from "./voice";
import { foldPlan, shouldSummarize, summarizeChat } from "./memory";

const line = (text: string, v: number[] | null, embedModel = "bge-m3:latest") => ({ text, context: "", embedding: v ? toBuffer(new Float32Array(v)) : null, embedModel });

test("vectors round-trip as Float32 little-endian (Delfino's encoding)", () => {
  const b = toBuffer(new Float32Array([1, -2.5, 3]));
  assert.equal(b.length, 12);
  assert.equal(b.readFloatLE(4), -2.5);
  assert.deepEqual([...toVector(b)!], [1, -2.5, 3]);
  assert.equal(toVector(Buffer.alloc(3)), null);
});

test("rankVoiceLines: cosine order, top-k, skips missing and other-model vectors", () => {
  const lines = [line("far", [0, 1]), line("near", [1, 0.1]), line("none", null), line("other", [1, 0], "nomic"), line("mid", [1, 1])];
  assert.deepEqual(rankVoiceLines([1, 0], lines, "bge-m3:latest", 2).map((l) => l.text), ["near", "mid"]);
  assert.deepEqual(rankVoiceLines([1, 0], [], "bge-m3:latest"), []);
});

const db = () => {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY, created_at INTEGER, kind TEXT, tags TEXT, note TEXT, persona TEXT)");
  migrateRp(d);
  return new RpStore(d);
};

test("selectVoiceLines returns [] when the embedder fails; embedVoiceLines fills only stale vectors", async () => {
  const s = db();
  const c = s.saveCharacter({ name: "Mio" });
  s.saveVoiceLine({ characterId: c, text: "Hmph." });
  s.saveVoiceLine({ characterId: c, text: "Baka!", context: "flustered" });
  const seen: string[][] = [];
  const r = await embedVoiceLines(s, c, "bge-m3:latest", async (_m, texts) => { seen.push(texts); return texts.map((_, i) => [1, i]); });
  assert.deepEqual(r, { embedded: 2, total: 2 });
  assert.deepEqual(seen[0], ["Hmph.", "(flustered) Baka!"]);
  assert.deepEqual(await embedVoiceLines(s, c, "bge-m3:latest", async () => { throw new Error("should not embed"); }), { embedded: 0, total: 2 });
  assert.deepEqual(await selectVoiceLines(s, c, "hello", "bge-m3:latest", async () => { throw new Error("offline"); }), []);
  assert.equal((await selectVoiceLines(s, c, "hello", "bge-m3:latest", async () => [[1, 0]]))[0].text, "Hmph.");
});

test("foldPlan: only turns past the mark, capped", () => {
  const msgs = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, role: "user" as const, content: `m${i}` }));
  assert.equal(foldPlan(msgs, 0, 60)!.batch.length, 60);
  assert.equal(foldPlan(msgs, 0, 60)!.through, 60);
  assert.equal(foldPlan(msgs, 95, 60)!.batch[0].id, 96);
  assert.equal(foldPlan(msgs, 100, 60), null);
});

test("summarizeChat stores the summary and mark; an empty reply keeps the old summary", async () => {
  const s = db();
  const c = s.saveCharacter({ name: "Mio", firstMessage: "Hi" });
  const chat = s.createChat(c);
  s.append(chat, "user", "Let's go to the castle");
  let prompt = "";
  await summarizeChat(s, chat, { model: "m", stream: async function* (msgs) { prompt = msgs.map((m) => m.content).join("\n"); yield "They headed "; yield "to the castle."; } });
  assert.match(prompt, /Mio: Hi[\s\S]*User: Let's go to the castle/);
  assert.equal(s.chat(chat)!.memorySummary, "They headed to the castle.");
  const mark = s.chat(chat)!.summarizedThrough;
  assert.ok(mark > 0);
  s.append(chat, "assistant", "Onward!");
  await summarizeChat(s, chat, { model: "m", stream: async function* () { yield "  "; } });
  assert.equal(s.chat(chat)!.memorySummary, "They headed to the castle.");
  assert.equal(s.chat(chat)!.summarizedThrough, mark);
});

test("shouldSummarize: after 20 new turns, or as soon as history is trimmed", () => {
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, role: "user", content: "" }));
  assert.equal(shouldSummarize(msgs(19), 0, false), false);
  assert.equal(shouldSummarize(msgs(20), 0, false), true);
  assert.equal(shouldSummarize(msgs(25), 10, false), false);
  assert.equal(shouldSummarize(msgs(3), 0, true), true);
  assert.equal(shouldSummarize(msgs(3), 3, true), false);
});
