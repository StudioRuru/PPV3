import { test } from "node:test";
import assert from "node:assert/strict";
import { asPersona, nextDrift, PERSONAS, personaBlock } from "./persona";

test("personas: Miyabi is the only co-pilot, Aru keeps the shop", () => {
  assert.deepEqual(PERSONAS.map((p) => p.id), ["miyabi", "aru"]);
});

test("personaBlock: voice + drift level; unknown persona adds nothing", () => {
  const b = personaBlock("miyabi", 80);
  assert.match(b, /Hoshimi Miyabi/);
  assert.match(b, /intensity 80\/100/);
  assert.ok(b.length < 1500, "bounded size");
  assert.equal(personaBlock("nope" as never, 0), "");
});

test("asPersona: aru stays, everything else (old neutral/bratty/writer/tagnerd, junk) is miyabi", () => {
  assert.equal(asPersona("aru"), "aru");
  for (const p of ["miyabi", "neutral", "bratty", "writer", "tagnerd", "", 5, null, undefined]) assert.equal(asPersona(p), "miyabi");
});

test("nextDrift: likes/applies push bolder, dislikes pull back, always 0–100", () => {
  assert.equal(nextDrift(10, "like"), 12);
  assert.equal(nextDrift(10, "apply"), 12);
  assert.equal(nextDrift(10, "dislike"), 6);
  assert.equal(nextDrift(99, "like"), 100);
  assert.equal(nextDrift(2, "dislike"), 0);
});

test("miyabi voice: loud, bratty, name-calling, short and caps", () => {
  const v = PERSONAS.find((p) => p.id === "miyabi")!.voice;
  for (const k of ["Hoshimi Miyabi", "Section 6", "LOUD", "brat", "baka", "CAPS", "hmph", "never a doormat"]) assert.ok(v.includes(k), k);
  assert.ok(v.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length <= 5);
});

test("aru persona: brewing schema, sliders, range, reserved names, no age words", async () => {
  const { personaBlock } = await import("./persona");
  const b = personaBlock("aru", 0);
  assert.match(b, /```vial/);
  for (const s of ["brat", "bimbo", "hypnosis", "heat", "length"]) assert.ok(b.includes(s), s);
  assert.match(b, /-3|−3/);
  assert.match(b, /Neutral vial/);
  assert.match(b, /remake a recipe, copy its name and sliders exactly/);
  assert.match(b, /Undo vial/);
  assert.match(b, /overdos|poison/i);
  assert.doesNotMatch(b, /adult|years old|year-old/i);
});

test("aru's example vial block is itself valid; reply shape stated", async () => {
  const { parseVialBlock } = await import("./mascot/vial");
  const b = personaBlock("aru", 0);
  const v = parseVialBlock(b.match(/```vial[\s\S]*?```/)![0]);
  assert.ok(v && !("error" in v), JSON.stringify(v));
  assert.match(b, /2-5 sentences/);
});
