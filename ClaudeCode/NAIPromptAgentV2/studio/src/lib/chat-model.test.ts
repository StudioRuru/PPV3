import { test } from "node:test";
import assert from "node:assert/strict";
import { modelFor } from "./chat-model";

test("modelFor: miyabi on the heavy tier, everyone else on the everyday brain", () => {
  const none = () => null;
  assert.equal(modelFor("miyabi", none, "brain"), "gemma4-26b-apex:latest");
  assert.equal(modelFor("miyabi", (k) => (k === "model.heavy" ? "cydonia" : null), "brain"), "cydonia");
  for (const p of ["neutral", "bratty", "writer", "tagnerd"] as const) assert.equal(modelFor(p, () => "x", "brain"), undefined);
});

test("chatPersona: miyabi threads take persona + talk length from the active identity; others keep their persona", async () => {
  const { chatPersona } = await import("./chat-model");
  const { identityOf } = await import("./mascot/identity");
  const { DEFAULT_MASCOT_SETTINGS: D } = await import("./mascot/settings");
  const { EMPTY_BLOCK } = await import("./mascot/slime");
  let reads = 0;
  const kit = () => { reads++; return identityOf({ ...D, voice: "You are Kit.", selfName: "Kit", sliders: { ...D.sliders, length: { value: 9, cap: 10 } } }, 40); };
  const m = chatPersona("miyabi", { tease: false }, 0, kit);
  assert.match(m.block, /# Personality: Kit\nYou are Kit\./);
  assert.match(m.block, /Kit is a smug show-off/);
  assert.match(m.block, /intensity 40\/100/);
  assert.deepEqual(m.options, { num_predict: 900 });
  assert.equal(chatPersona("miyabi", {}, 0, () => identityOf({ ...D, empty: true }, 0)).block, EMPTY_BLOCK);
  const w = chatPersona("writer", { tease: true }, 20, kit);
  assert.match(w.block, /Scene writer/);
  assert.equal(w.options, undefined);
  assert.equal(reads, 1, "identity only read for miyabi");
});
