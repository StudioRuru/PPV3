import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreReply, summarize } from "./bench";

test("bench: echo, opening repeats, slop, agency, length, style breaks, memory", () => {
  const prior = ["She leans on the bar and grins at you, slow and wicked."];
  const s = scoreReply("She leans on the bar and grins at you again. Kai smiles back. A shiver down her spine.", prior,
    { style: "", length: 2, user: "Kai", expect: "harbou?r" });
  assert.ok(s.echo > 0.4);
  assert.equal(s.openingRepeat, true);
  assert.deepEqual(s.slop, ["shiver down"]);
  assert.equal(s.agency, 1);
  assert.equal(s.lengthOk, false); // 18 words < 30 for Natural
  assert.equal(s.memory, false);
  const fresh = scoreReply("\"The harbour master owes me,\" Rin says, tapping the coin twice.", prior, { style: "rp", length: 1, user: "Kai", expect: "harbou?r" });
  assert.equal(fresh.echo, 0);
  assert.equal(fresh.memory, true);
  assert.equal(fresh.styleBreak, false); // "me" inside dialogue is fine
  assert.equal(scoreReply("I sigh.", [], { style: "rp", length: 0, user: "Kai" }).styleBreak, true);
  const t = scoreReply("omg hi\n\nwyd rn", [], { style: "text", length: 1, user: "Kai" });
  assert.ok(t.lengthOk && !t.styleBreak);
  assert.equal(scoreReply("*waves*\n\nhi", [], { style: "text", length: 1, user: "Kai" }).styleBreak, true);
  const sum = summarize([s, fresh], [7, 9]);
  assert.equal(sum.openingRepeats, 1);
  assert.equal(sum.memory, 0.5);
  assert.equal(sum.judge, 8);
});

test("podBody: Ollama options map to llama-server, llama.cpp samplers pass through", async () => {
  const { podBody, isPod } = await import("../llm");
  const b = podBody([{ role: "user", content: "hi" }], "pod:behemoth-128b", { temperature: 0.8, num_predict: 400, num_ctx: 16384, dry_multiplier: 0.8 }, ["\nKai:"]);
  assert.deepEqual(b, { model: "behemoth-128b", stream: true, messages: [{ role: "user", content: "hi" }], temperature: 0.8, dry_multiplier: 0.8, max_tokens: 400, stop: ["\nKai:"] });
  assert.ok(isPod("pod:x") && !isPod("gemma4-26b-apex") && !isPod(undefined));
});

test("podBody: a kobold: model drops its prefix and gets DRY by default; options still win", async () => {
  const { podBody, isPod, isKobold } = await import("../llm");
  const b = podBody([], "kobold:koboldcpp/omega", { dry_multiplier: 0 });
  assert.equal(b.model, "koboldcpp/omega");
  assert.equal(b.dry_multiplier, 0);
  assert.equal(b.dry_base, 1.75);
  assert.ok(isKobold("kobold:x") && !isPod("kobold:x") && !isKobold("pod:x"));
});

test("scoreReply text style uses bursts", () => {
  assert.equal(scoreReply("a\n---\nb\n---\nc", [], { style: "text", length: 3, user: "Kai" }).lengthOk, true);
  assert.equal(scoreReply("[react:😭]\nok\n---\nfine", [], { style: "text", length: 2, user: "Kai" }).styleBreak, false);
});
