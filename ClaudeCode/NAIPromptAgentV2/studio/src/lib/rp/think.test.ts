import { test } from "node:test";
import assert from "node:assert/strict";
import { THINK_TAG, stripThoughtEcho, thinkOn, thinkRequest, withThought } from "./think";
import { DEFAULT_RP_SETTINGS, type RpChat } from "./types";
import type { Turn } from "./turn";

const turn = (): Turn => ({
  model: "gemma4-26b-apex", truncated: false, options: { temperature: 0.8, num_predict: 600 },
  messages: [{ role: "system", content: "You are Alice." }, { role: "assistant", content: "Hi!" }, { role: "user", content: "Where are we?" }],
});

test("thinkRequest caps tokens, lowers temperature, keeps the model", () => {
  const r = thinkRequest(turn(), "Alice");
  assert.equal(r.options.num_predict, 200);
  assert.ok(Math.abs(r.options.temperature! - 0.6) < 1e-9);
  assert.equal(r.model, "gemma4-26b-apex");
  assert.match(r.messages.at(-1)!.content, /Where are we\?[\s\S]*Alice/);
  assert.equal(thinkRequest({ ...turn(), options: { temperature: 0.55 } }, "Alice").options.temperature, 0.5);
});

test("withThought placement: the note rides the last user turn and the system block stays single", () => {
  const r = withThought(turn(), "I notice they're lost.\nI'll tease them.");
  assert.equal(r.messages.filter((m) => m.role === "system").length, 1);
  assert.equal(r.messages[0].content, "You are Alice.");
  const last = r.messages.at(-1)!;
  assert.equal(last.role, "user");
  assert.ok(last.content.includes(THINK_TAG));
  assert.ok(last.content.includes("I'll tease them."));
  assert.ok(last.content.endsWith("Where are we?"));
});

test("stripThoughtEcho removes a leaked tag line and an echoed first line, nothing else", () => {
  const thought = "I notice they're lost.\nI'll tease them.";
  assert.equal(stripThoughtEcho(`${THINK_TAG}\n"Lost, are we?"`, thought), '"Lost, are we?"');
  assert.equal(stripThoughtEcho("I notice they're lost.\n\n\"Lost, are we?\"", thought), '"Lost, are we?"');
  assert.equal(stripThoughtEcho('"Lost, are we?" *She grins.*', thought), '"Lost, are we?" *She grins.*');
});

test("thinkOn: chat override, then the mode setting, then off", () => {
  const chat = (think: number | null) => ({ think }) as RpChat;
  const s = { ...DEFAULT_RP_SETTINGS, thinkByMode: { rp: true, text: false } };
  assert.equal(thinkOn(chat(0), "rp", s), false);
  assert.equal(thinkOn(chat(1), "text", s), true);
  assert.equal(thinkOn(chat(null), "rp", s), true);
  assert.equal(thinkOn(chat(null), "text", s), false);
  assert.equal(thinkOn(chat(null), "rp", DEFAULT_RP_SETTINGS), false);
});
