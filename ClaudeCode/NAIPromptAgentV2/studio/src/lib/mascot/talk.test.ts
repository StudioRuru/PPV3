import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPRESSIONS } from "./core";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { listSprites, perImage, pick, saveCandidates, talkCandidatePath, talkPath, talkRequest, target } from "./sprites";
import { listenPhase, pickTalkFrame, portraitPick, TALK, TALK_FRAMES, TALK_UC, talkKey } from "./talk";
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

test("nextPhase: send→think, firstToken→talk, end→done, error→idle, reset→idle; empty ignores events", async () => {
  const { nextPhase } = await import("./talk");
  assert.equal(nextPhase("idle", "send"), "think");
  assert.equal(nextPhase("think", "firstToken"), "talk");
  assert.equal(nextPhase("talk", "end"), "done");
  assert.equal(nextPhase("think", "end"), "done");
  assert.equal(nextPhase("think", "error"), "idle");
  assert.equal(nextPhase("talk", "error"), "idle");
  assert.equal(nextPhase("done", "reset"), "idle");
  assert.equal(nextPhase("done", "send"), "think");
  for (const e of ["send", "firstToken", "end", "error", "reset"] as const) assert.equal(nextPhase("empty", e), "empty");
});

test("talkFrame: listen, think/talk alternate per tick, done/idle show the expression, empty is smug", async () => {
  const { talkFrame } = await import("./talk");
  assert.equal(talkFrame("listen", 3, "wink"), "listen");
  assert.deepEqual([0, 1, 2].map((t) => talkFrame("think", t, "wink")), ["think1", "think2", "think1"]);
  assert.deepEqual([0, 1, 2].map((t) => talkFrame("talk", t, "wink")), ["talk_open", "talk_closed", "talk_open"]);
  assert.equal(talkFrame("done", 5, "wink"), "wink");
  assert.equal(talkFrame("idle", 5, "pout"), "pout");
  assert.equal(talkFrame("empty", 5, "pout"), "smug");
});

test("splitExpressionTag: trailing valid tag stripped; invalid, mid-text, missing → smug, text unchanged", async () => {
  const { splitExpressionTag } = await import("./talk");
  assert.deepEqual(splitExpressionTag("Hi there. [Wink]"), { text: "Hi there.", expression: "wink" });
  assert.deepEqual(splitExpressionTag("Hi [pout]  \n"), { text: "Hi", expression: "pout" });
  assert.deepEqual(splitExpressionTag("Hi [grumpy]"), { text: "Hi [grumpy]", expression: "smug" });
  assert.deepEqual(splitExpressionTag("[sleepy] then more"), { text: "[sleepy] then more", expression: "smug" });
  assert.deepEqual(splitExpressionTag("plain"), { text: "plain", expression: "smug" });
});

test("visibleWhileStreaming hides a trailing partial/complete [word]", async () => {
  const { visibleWhileStreaming: v } = await import("./talk");
  assert.equal(v("hi [smu"), "hi ");
  assert.equal(v("hi [smug]"), "hi ");
  assert.equal(v("hi ["), "hi ");
  assert.equal(v("hi [smug] there"), "hi [smug] there");
  assert.equal(v("hi"), "hi");
});

test("tick constants", async () => {
  const { TALK_TICK_MS, THINK_TICK_MS } = await import("./talk");
  assert.equal(TALK_TICK_MS, 280);
  assert.equal(THINK_TICK_MS, 700);
});

test("splitExpressionTag: warning suffix kept, tag before it stripped; multiple trailing tags; tag-only", async () => {
  const { splitExpressionTag: sp } = await import("./talk");
  assert.deepEqual(sp("Hi [pout]\n\n⚠️ Not saved"), { text: "Hi\n\n⚠️ Not saved", expression: "pout" });
  assert.deepEqual(sp("Hi [wink] [smug]"), { text: "Hi", expression: "smug" });
  assert.deepEqual(sp("[excited]"), { text: "", expression: "excited" });
});

test("visibleWhileStreaming only hides expression-name prefixes", async () => {
  const { visibleWhileStreaming: v } = await import("./talk");
  assert.equal(v("see [note]"), "see [note]");
  assert.equal(v("see [no"), "see [no");
  assert.equal(v("hi [sl"), "hi ");
  assert.equal(v("hi [smu]"), "hi [smu]");
});

test("listenPhase: focus listens only when nothing is in flight; blur drops listen", () => {
  assert.equal(listenPhase("idle", true), "listen");
  assert.equal(listenPhase("done", true), "listen");
  assert.equal(listenPhase("think", true), "think");
  assert.equal(listenPhase("talk", true), "talk");
  assert.equal(listenPhase("empty", true), "empty");
  assert.equal(listenPhase("listen", false), "idle");
  assert.equal(listenPhase("done", false), "done");
  assert.equal(listenPhase("think", false), "think");
});

test("portraitPick: talk chain, then bust, then placeholder; bob when a motion frame is missing", () => {
  const have = new Set(["talk/day/smug", "talk/night/think1", "night/pout", "day/smug"]);
  assert.deepEqual(portraitPick(have, "night", "think1"), { key: "talk/night/think1", bob: false });
  assert.deepEqual(portraitPick(have, "night", "think2"), { key: "talk/day/smug", bob: true });
  assert.deepEqual(portraitPick(have, "night", "pout"), { key: "talk/day/smug", bob: false });
  const busts = new Set(["night/pout", "day/smug"]);
  assert.deepEqual(portraitPick(busts, "night", "pout"), { key: "night/pout", bob: false });
  assert.deepEqual(portraitPick(busts, "night", "talk_open"), { key: "day/smug", bob: true });
  assert.deepEqual(portraitPick(new Set(), "day", "listen"), { key: null, bob: true });
});

test("splitExpressionTag: a model-written ⚠️ paragraph mid-reply doesn't hide the tag; only the last (server) warning is kept apart", async () => {
  const { splitExpressionTag } = await import("./talk");
  const reply = "Careful.\n\n⚠️ that armor tag is dead.\n\nUse torn armor. [smug]\n\n⚠️ Not saved: this chat was changed or deleted elsewhere while I was answering.";
  assert.deepEqual(splitExpressionTag(reply), { text: "Careful.\n\n⚠️ that armor tag is dead.\n\nUse torn armor.\n\n⚠️ Not saved: this chat was changed or deleted elsewhere while I was answering.", expression: "smug" });
});

test("TALK_UC blocks two-view sheets", () => {
  for (const t of ["multiple views", "reference sheet", "inset", "split screen"]) assert.ok(TALK_UC.includes(t));
});

test("portraitPick: chat keys fall back to the closest legacy still", () => {
  const busts = new Set(["day/pout", "day/excited", "day/smug", "day/flirty"]);
  for (const [k, want] of [["sad", "pout"], ["pouty", "pout"], ["happy", "excited"], ["horny", "flirty"], ["neutral", "smug"]]) assert.equal(portraitPick(busts, "day", k as never).key, `day/${want}`);
});
