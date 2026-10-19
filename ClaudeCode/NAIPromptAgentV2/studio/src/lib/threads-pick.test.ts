import { test } from "node:test";
import assert from "node:assert/strict";
import { canCompose, chatTabThreads, defaultThreadId, isCompanion, newThreadPersona } from "./threads-pick";

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

test("composer: Miyabi needs Ollama reachable, not the brain loaded (heavy pause unloads it); an empty slime always sends", () => {
  assert.equal(canCompose({ on: false, brain: true }, false), true); // brain unloaded after an APEX reply
  assert.equal(canCompose({ on: false, brain: false }, false), false); // Ollama down
  assert.equal(canCompose(null, false), false); // status not loaded yet
  assert.equal(canCompose({ on: false, brain: false }, true), true); // "Data received." needs no model
  assert.equal(canCompose(null, true), true);
});

test("only companion-mode threads are Just Chat; missing mode or no thread is not", () => {
  assert.equal(isCompanion({ mode: "companion" }), true);
  assert.equal(isCompanion({ mode: "copilot" }), false);
  assert.equal(isCompanion({}), false);
  assert.equal(isCompanion(null), false);
});
