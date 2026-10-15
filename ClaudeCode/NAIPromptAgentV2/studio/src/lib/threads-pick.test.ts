import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultThreadId, newThreadPersona } from "./threads-pick";

const T = (id: number, persona: string) => ({ id, persona });

test("default thread skips Miyabi threads; null when only Miyabi", () => {
  assert.equal(defaultThreadId([T(1, "miyabi"), T(2, "neutral")]), 2);
  assert.equal(defaultThreadId([T(1, "miyabi")]), null);
  assert.equal(defaultThreadId([]), null);
});

test("new chat never inherits miyabi", () => {
  assert.equal(newThreadPersona("miyabi"), "neutral");
  assert.equal(newThreadPersona(undefined), "neutral");
  assert.equal(newThreadPersona("tsundere"), "tsundere");
});

test("aru threads are skipped and never inherited", () => {
  assert.equal(defaultThreadId([T(1, "aru"), T(2, "neutral")]), 2);
  assert.equal(defaultThreadId([T(1, "aru")]), null);
  assert.equal(newThreadPersona("aru"), "neutral");
});

test("final review: chat-tab chips exclude Miyabi and Aru threads", async () => {
  const { chatTabThreads } = await import("./threads-pick");
  assert.deepEqual(chatTabThreads([T(1, "aru"), T(2, "neutral"), T(3, "miyabi"), T(4, "bratty")]).map((t) => t.id), [2, 4]);
});
