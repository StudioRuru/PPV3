import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPRESSIONS } from "./core";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { listSprites, perImage, pick, saveCandidates, talkCandidatePath, talkPath, talkRequest, target } from "./sprites";
import { pickTalkFrame, TALK, TALK_FRAMES, talkKey } from "./talk";
import { missingTalkCells } from "./ui";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "talk-"));

test("TALK_FRAMES: the 9 expressions then think1, think2, talk_open, talk_closed, listen", () => {
  assert.deepEqual([...TALK_FRAMES], [...EXPRESSIONS, "think1", "think2", "talk_open", "talk_closed", "listen"]);
  assert.equal(TALK, "upper body, cowboy shot, looking at viewer, simple background, white background");
});

test("talkRequest: waist-up framing, 1024², 28 steps (free); expression tags only for expression frames", () => {
  const e = talkRequest("day", "pout", S, 7);
  assert.equal(e.compiled.base, [S.charTags, S.constantTags, S.layerTags.day, S.exprTags.pout, TALK].join(", "));
  assert.deepEqual([e.params.width, e.params.height, e.params.steps, e.params.seed], [1024, 1024, 28, 7]);
  assert.equal(perImage(e.params), 0);
  const small: Record<string, string> = { think1: "thinking, looking up, hand on own chin", think2: "thinking, looking up, hand on own chin", talk_open: "open mouth, talking", talk_closed: "closed mouth", listen: "head tilt, attentive, slight smile" };
  for (const [f, tags] of Object.entries(small)) {
    const b = talkRequest("night", f as never, S).compiled.base;
    assert.equal(b, [S.charTags, S.constantTags, S.layerTags.night, tags, TALK].join(", "));
    for (const x of EXPRESSIONS) assert.ok(!b.includes(S.exprTags[x]), `${f} has no ${x} tags`);
  }
  assert.notEqual(talkRequest("day", "smug", S).params.seed, talkRequest("day", "smug", S).params.seed);
});

test("talk paths: whitelisted frames + outfits only, candidates 0..3, no traversal", () => {
  assert.equal(talkPath("/d", "day", "listen"), path.join("/d", "talk", "day", "listen.png"));
  assert.equal(talkCandidatePath("/d", "night", "smug", 2), path.join("/d", "candidates", "talk", "night", "smug", "2.png"));
  for (const [o, n] of [["x", "smug"], ["day", "full"], ["day", "../smug"], ["day", "think3"], ["..", "smug"]]) assert.equal(talkPath("/d", o, n), null);
  for (const i of [-1, 4, 1.5, NaN]) assert.equal(talkCandidatePath("/d", "day", "smug", i), null);
});

test("target: talk param picks a talk frame (outfit required); bad frame null", () => {
  assert.deepEqual(target({ outfit: "day", talk: "think1" }), { outfit: "day", kind: "bust", expr: "smug", name: "think1", talk: "think1" });
  assert.equal(target({ outfit: "day", talk: "pout" })?.expr, "pout");
  assert.equal(target({ outfit: "day", talk: "nope" }), null);
  assert.equal(target({ outfit: "x", talk: "smug" }), null);
});

test("saveCandidates + pick + listSprites for talk frames", async () => {
  const d = tmp();
  saveCandidates(d, "day", "listen", [PNG, PNG], [1, 2], undefined, "listen");
  assert.ok(fs.existsSync(talkCandidatePath(d, "day", "listen", 1)!));
  const r = await pick(d, "day", "listen", 1, (async () => new Response(null, { status: 500 })) as never, undefined, "listen");
  assert.ok("ok" in r);
  assert.ok(fs.existsSync(talkPath(d, "day", "listen")!.replace(/\.png$/, ".orig.png")));
  assert.ok("talk/day/listen" in listSprites(d).sprites);
  assert.ok(!("talk/day/smug" in listSprites(d).sprites));
});

test("pickTalkFrame: frame → outfit smug → day frame → day smug → null", () => {
  const k = talkKey;
  const all = new Set([k("night", "wink"), k("night", "smug"), k("day", "wink"), k("day", "smug")]);
  assert.equal(pickTalkFrame(all, "night", "wink"), k("night", "wink"));
  all.delete(k("night", "wink"));
  assert.equal(pickTalkFrame(all, "night", "wink"), k("night", "smug"));
  all.delete(k("night", "smug"));
  assert.equal(pickTalkFrame(all, "night", "wink"), k("day", "wink"));
  all.delete(k("day", "wink"));
  assert.equal(pickTalkFrame(all, "night", "wink"), k("day", "smug"));
  all.delete(k("day", "smug"));
  assert.equal(pickTalkFrame(all, "night", "wink"), null);
  assert.equal(pickTalkFrame(new Set([k("day", "smug")]), "day", "think1"), k("day", "smug"));
  assert.equal(pickTalkFrame(new Set(["pose/stand/day/smug"]), "day", "listen"), null);
});

test("missingTalkCells: frames of an outfit not saved yet, in order", () => {
  assert.deepEqual(missingTalkCells({}, "day"), [...TALK_FRAMES]);
  const have = { [talkKey("day", "smug")]: 1, [talkKey("night", "listen")]: 1 };
  assert.ok(!missingTalkCells(have, "day").includes("smug") && missingTalkCells(have, "day").length === 13);
  assert.ok(missingTalkCells(have, "night").includes("smug") && !missingTalkCells(have, "night").includes("listen"));
});
