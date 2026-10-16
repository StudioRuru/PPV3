import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTabThreads, defaultThreadId, newThreadPersona } from "./threads-pick";

const T = (id: number, persona: string) => ({ id, persona });

test("default thread is the first Miyabi thread; Aru's never; null when none", () => {
  assert.equal(defaultThreadId([T(1, "aru"), T(2, "miyabi")]), 2);
  assert.equal(defaultThreadId([T(1, "aru")]), null);
  assert.equal(defaultThreadId([]), null);
});

test("new chats are always Miyabi's", () => {
  assert.equal(newThreadPersona(), "miyabi");
});

test("chat-tab chips show Miyabi threads and hide Aru's", () => {
  assert.deepEqual(chatTabThreads([T(1, "aru"), T(2, "miyabi"), T(3, "miyabi")]).map((t) => t.id), [2, 3]);
});
