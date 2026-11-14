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

import { profileSlice, resolveAgency, resolveSpice, type RpProfile } from "./profile";
import { DEFAULT_RP_SETTINGS, type RpChat, type RpCharacter } from "./types";

const prof = (o: Partial<RpProfile> = {}): RpProfile => ({ ...parseProfile({ displayName: "Rin" })!, ...o });
const S = { ...DEFAULT_RP_SETTINGS, replyAgency: 0, replySpice: 1 };
const ch = (agency: number | null, spice: number | null = null) => ({ replyAgency: agency, replySpice: spice }) as RpChat;
const ca = (agency: number | null) => ({ agency }) as RpCharacter;

test("resolveAgency order", () => {
  const p = prof({ defaults: { agency: 2 } });
  assert.equal(resolveAgency(ch(4), ca(1), p, S), 4);
  assert.equal(resolveAgency(ch(null), ca(1), p, S), 1);
  assert.equal(resolveAgency(ch(null), ca(null), p, S), 2);
  assert.equal(resolveAgency(ch(null), ca(null), null, S), 0);
});

test("resolveSpice clamps", () => {
  assert.equal(resolveSpice(ch(null, 4), prof({ defaults: { spice: { min: 0, max: 2 } } }), S), 2);
  assert.equal(resolveSpice(ch(null), prof({ defaults: { spice: { min: 2, max: 3 } } }), S), 2);
  assert.equal(resolveSpice(ch(null, 3), null, S), 3);
});

const full = (n = 4) => prof({
  cast: [{ name: "Rin", role: "lead" }, { name: "Mio", role: "sister" }], format: "Rin's Thoughts: **…**",
  wouldNever: ["break character", "call the user master"], speech: { register: "blunt, clipped", tics: ["tch", "hmph"], sampleLines: ["Don't get the wrong idea.", "Whatever."] },
  coreTraits: ["proud", "loyal", "jealous", "clumsy", "secretly kind"].slice(0, n), wants: ["to win"], fears: ["being pitied"], hooks: ["her missing sister"],
});

test("profileSlice always-on parts", () => {
  const s = profileSlice(full(), "rp", 0);
  for (const x of ["Rin", "Mio", "Rin's Thoughts: **…**", "break character", "call the user master", "blunt, clipped"]) assert.ok(s.includes(x), x);
  assert.ok(s.includes("tch") || s.includes("hmph"));
});

test("profileSlice rotates deterministically", () => {
  assert.notEqual(profileSlice(full(), "rp", 0), profileSlice(full(), "rp", 1));
  assert.equal(profileSlice(full(), "rp", 3), profileSlice(full(), "rp", 3));
});

test("profileSlice mode bias", () => {
  const t = profileSlice(full(), "text", 0), r = profileSlice(full(), "rp", 0);
  assert.ok(t.includes("Don't get the wrong idea.") || t.includes("Whatever."));
  assert.ok(r.includes("her missing sister"));
  assert.ok(!r.includes("Don't get the wrong idea.") && !r.includes("Whatever."));
});

test("profileSlice length", () => {
  const L = (k: string) => Array.from({ length: 12 }, (_, i) => `${k} item number ${i} with some words`);
  const p = prof({ cast: [{ name: "Rin", role: "lead" }], coreTraits: L("trait"), wants: L("want"), fears: L("fear"), hooks: L("hook"), wouldNever: L("never").slice(0, 3),
    speech: { register: "blunt", tics: L("tic"), sampleLines: L("line") }, format: "plain" });
  assert.ok(profileSlice(p, "text", 5).length < 1100);
  assert.ok(profileSlice(p, "rp", 5).length < 1100);
});
