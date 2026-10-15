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
