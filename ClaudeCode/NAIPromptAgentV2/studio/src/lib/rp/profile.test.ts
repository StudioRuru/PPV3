import { test } from "node:test";
import assert from "node:assert/strict";
import { charName, parseProfile } from "./profile";

test("parseProfile tolerates junk", () => {
  assert.equal(parseProfile("nope"), null);
  assert.equal(parseProfile({}), null);
  assert.equal(parseProfile(null), null);
  const p = parseProfile({ displayName: "Alice", coreTraits: "bubbly" })!;
  assert.equal(p.displayName, "Alice");
  assert.deepEqual(p.coreTraits, []);
  assert.deepEqual(p.cast, []);
  assert.deepEqual(p.speech.tics, []);
  assert.deepEqual(p.defaults, {});
});

test("parseProfile reads a JSON string and fixes inverted spice", () => {
  const p = parseProfile(JSON.stringify({ displayName: "Mio", wants: ["praise", 3], defaults: { spice: { min: 3, max: 1 }, mode: "text", agency: 9 } }))!;
  assert.deepEqual(p.wants, ["praise"]);
  assert.deepEqual(p.defaults.spice, { min: 1, max: 3 });
  assert.equal(p.defaults.mode, "text");
  assert.equal(p.defaults.agency, 4);
});

test("charName prefers displayName", () => {
  assert.equal(charName({ name: "Alice in Wonderland | Lost Elf", displayName: "Alice" }), "Alice");
  assert.equal(charName({ name: "Alice in Wonderland", displayName: "" }), "Alice in Wonderland");
});
