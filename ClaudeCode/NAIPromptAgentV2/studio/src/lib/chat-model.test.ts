import { test } from "node:test";
import assert from "node:assert/strict";
import { modelFor } from "./chat-model";

test("modelFor: miyabi on the heavy tier, everyone else on the everyday brain", () => {
  const none = () => null;
  assert.equal(modelFor("miyabi", none, "brain"), "gemma4-26b-apex:latest");
  assert.equal(modelFor("miyabi", (k) => (k === "model.heavy" ? "cydonia" : null), "brain"), "cydonia");
  for (const p of ["neutral", "bratty", "writer", "tagnerd"] as const) assert.equal(modelFor(p, () => "x", "brain"), undefined);
});
