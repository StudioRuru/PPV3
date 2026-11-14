import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSystem, type Turn } from "./turn";

test("foldSystem: one lead system block, deep notes onto the next user turn, trailing notes onto the last", () => {
  const t = (messages: { role: string; content: string }[]) => ({ messages, options: {}, model: "m", truncated: false }) as unknown as Turn;
  const r = foldSystem(t([
    { role: "system", content: "S1" }, { role: "system", content: "S2" }, { role: "assistant", content: "hi" },
    { role: "user", content: "u1" }, { role: "system", content: "note" }, { role: "assistant", content: "a1" },
    { role: "user", content: "u2" }, { role: "system", content: "fresh" }, { role: "system", content: "jb" },
  ]));
  assert.deepEqual(r.messages, [
    { role: "system", content: "S1\n\nS2" }, { role: "assistant", content: "hi" }, { role: "user", content: "u1" },
    { role: "assistant", content: "a1" }, { role: "user", content: "note\n\nu2\n\nfresh\n\njb" },
  ]);
});
