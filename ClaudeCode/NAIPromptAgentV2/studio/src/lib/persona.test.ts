import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDrift, PERSONAS, personaBlock } from "./persona";

test("personas: neutral default plus the three chosen ones", () => {
  assert.deepEqual(PERSONAS.map((p) => p.id), ["neutral", "bratty", "writer", "tagnerd"]);
});

test("personaBlock: voice + modifiers + drift level; neutral with nothing on adds nothing", () => {
  assert.equal(personaBlock("neutral", {}, 0), "");
  const b = personaBlock("bratty", { tease: true, flirt: true }, 80);
  assert.match(b, /Bratty muse/);
  assert.match(b, /tease/i);
  assert.match(b, /flirt/i);
  assert.match(b, /intensity 80\/100/);
  assert.ok(b.length < 1500, "bounded size");
  assert.equal(personaBlock("nope" as never, {}, 0), "", "unknown persona → neutral");
});

test("nextDrift: likes/applies push bolder, dislikes pull back, always 0–100", () => {
  assert.equal(nextDrift(10, "like"), 12);
  assert.equal(nextDrift(10, "apply"), 12);
  assert.equal(nextDrift(10, "dislike"), 6);
  assert.equal(nextDrift(99, "like"), 100);
  assert.equal(nextDrift(2, "dislike"), 0);
});
