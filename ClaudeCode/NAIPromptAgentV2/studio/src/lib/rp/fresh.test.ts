import { test } from "node:test";
import assert from "node:assert/strict";
import { freshNotes, hasStatus, repeatedPhrases, voiceLine } from "./fresh";
import { parseProfile } from "./profile";
import { steerTurn } from "./turn";
import { thinkOn, thinkRequest } from "./think";
import { DEFAULT_RP_SETTINGS, type RpChat } from "./types";

test("hasStatus: a stat line with numbers counts; prose and plain bold don't", () => {
  assert.ok(hasStatus("She nods.\n\n***1 MERIT, 25 CP***"));
  assert.ok(hasStatus("[HP: 40/50 | Gold: 12]\nYou enter."));
  assert.ok(!hasStatus("*She counts to 3 and smiles.*"));
  assert.ok(!hasStatus("**Hey!**"));
});

test("repeatedPhrases: phrases in 2+ replies, stock slop that showed up; names and status lines ignored", () => {
  const replies = [
    "Her breath hitches as she steps back, knuckles turning white. Hewitt says nothing.\n***1 MERIT, 25 CP***",
    "She steps back again, trembling. Her breath hitches. Hewitt says nothing at all.\n***1 MERIT, 25 CP***",
    "A quiet room. She looks away.",
  ];
  const p = repeatedPhrases(replies, ["Hewitt"]);
  assert.ok(p.includes("breath hitches"), p.join("|"));
  assert.ok(p.includes("trembling"));
  assert.ok(p.some((x) => /steps back/.test(x)));
  assert.ok(!p.some((x) => /hewitt|merit/i.test(x)), p.join("|"));
  assert.deepEqual(repeatedPhrases(["Hello there friend.", "Something else entirely."], []), []);
});

test("freshNotes text mode: same opener, question endings, a silent cast member", () => {
  const bursts = [
    "Fuwawa: omg hi\n---\nFuwawa: mococo is literally asleep rn\n---\nFuwawa: what about you? 👀",
    "Fuwawa: omg wait\n---\nFuwawa: mococo is literally eating rn\n---\nFuwawa: who's first? 👀",
    "Fuwawa: omg ok\n---\nFuwawa: guess what? 👀",
  ];
  const n = freshNotes(bursts, { mode: "text", cast: ["Fuwawa", "Mococo"], names: [] }).join("\n");
  assert.match(n, /don't open with "omg"/i);
  assert.match(n, /statement or an action/);
  assert.match(n, /Mococo/);
  assert.doesNotMatch(n, /Fuwawa sends/);
  assert.equal(freshNotes(["hi there", "what's up?"], { mode: "text", cast: [], names: [] }).length, 0);
});

test("freshNotes: a status card is told to update it", () => {
  const n = freshNotes(["She frowns.\n***1 MERIT, 25 CP***"], { mode: "rp", cast: [], names: [] }).join("\n");
  assert.match(n, /status/i);
});

test("voiceLine: register and habits every turn; nothing without a profile voice", () => {
  const p = parseProfile({ speech: { register: "clipped, formal", tics: ["says 'indeed'"] }, wouldNever: ["swear"] })!;
  assert.match(voiceLine(p, "Hewitt"), /Hewitt[\s\S]*clipped, formal[\s\S]*indeed[\s\S]*swear/);
  assert.equal(voiceLine(parseProfile({ displayName: "x" }), "x"), "");
  assert.equal(voiceLine(null, "x"), "");
});

test("steerTurn carries the extra notes and the voice line on every turn", () => {
  const t = { messages: [], options: {}, model: "m", truncated: false };
  const p = parseProfile({ speech: { register: "clipped" } });
  const c = steerTurn(t, { spice: 0, charName: "Mio", userName: "Kai", profile: p, notes: ["NOTE-1"] }, () => 0.99).messages[0].content;
  assert.match(c, /NOTE-1/);
  assert.match(c, /clipped/);
});

test("thinkOn: a status card turns thinking on unless the chat turned it off; the plan asks what changed", () => {
  const chat = (think: number | null) => ({ think }) as RpChat;
  assert.equal(thinkOn(chat(null), "rp", DEFAULT_RP_SETTINGS, true), true);
  assert.equal(thinkOn(chat(0), "rp", DEFAULT_RP_SETTINGS, true), false);
  assert.equal(thinkOn(chat(1), "rp", DEFAULT_RP_SETTINGS, false), true);
  const turn = { model: "m", truncated: false, options: {}, messages: [{ role: "user" as const, content: "hi" }] };
  assert.match(thinkRequest(turn, "Hewitt", true).messages.at(-1)!.content, /changed/);
  assert.doesNotMatch(thinkRequest(turn, "Hewitt").messages.at(-1)!.content, /changed/);
});
