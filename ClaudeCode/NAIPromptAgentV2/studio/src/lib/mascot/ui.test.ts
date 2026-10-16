import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSIONS } from "./core";
import { composerBottom, cooldownLabel, cooldownToSlider, COOLDOWN_STEPS, deltaChips, diffTags, groupBottles, missingCells, missingPoseCells, nearestCorner, poisonTone, requestSeq, sliderToCooldown, stripVialBlock, vialOutcome, bottledKey, singleFlight, historyForRegenerate, historyForEdit } from "./ui";

test("diffTags: added and removed, order kept, dupes ignored", () => {
  assert.deepEqual(diffTags(["a", "b", "c"], ["b", "d", "c", "d"]), { added: ["d"], removed: ["a"] });
  assert.deepEqual(diffTags(["a"], ["a"]), { added: [], removed: [] });
  assert.deepEqual(diffTags([], ["x", "y"]), { added: ["x", "y"], removed: [] });
});
test("nearestCorner: picks the viewport quadrant of the point", () => {
  assert.equal(nearestCorner(350, 700, 400, 800), "br");
  assert.equal(nearestCorner(10, 700, 400, 800), "bl");
  assert.equal(nearestCorner(390, 10, 400, 800), "tr");
  assert.equal(nearestCorner(0, 0, 400, 800), "tl");
  assert.equal(nearestCorner(200, 400, 400, 800), "br"); // dead centre stays bottom-right
});
test("composerBottom: tallest visible clearance from the viewport bottom + gap (fixed bars sit above the safe area too); fallback when none", () => {
  const fb = "calc(env(safe-area-inset-bottom) + 5rem)";
  assert.equal(composerBottom([]), fb);
  assert.equal(composerBottom([0, 0]), fb); // display:none composers measure 0
  assert.equal(composerBottom([0, 100, 72]), "calc(100px + 0.5rem)");
  assert.equal(composerBottom([0, 130.2]), "calc(131px + 0.5rem)"); // camera roll bar floating above the bottom edge
});

test("cooldown slider: steps ↔ ms, last step = only when tapped", () => {
  assert.equal(sliderToCooldown(0), 30000);
  assert.equal(sliderToCooldown(COOLDOWN_STEPS.length - 1), 600000);
  assert.equal(sliderToCooldown(COOLDOWN_STEPS.length), null);
  assert.equal(cooldownToSlider(null), COOLDOWN_STEPS.length);
  assert.equal(cooldownToSlider(120000), COOLDOWN_STEPS.indexOf(120000));
  assert.equal(cooldownToSlider(130000), COOLDOWN_STEPS.indexOf(120000)); // nearest step
  assert.equal(cooldownLabel(null), "Only when tapped");
  assert.equal(cooldownLabel(30000), "30 s");
  assert.equal(cooldownLabel(120000), "2 min");
});
test("missingCells: full first, then bust expressions without a sprite for that outfit", () => {
  const all = ["full", ...EXPRESSIONS];
  const have = Object.fromEntries(all.filter((n) => n !== "wink").map((n) => [`day/${n}`, 1]));
  assert.deepEqual(missingCells(have, "day"), [{ kind: "bust", expr: "wink" }]);
  const cells = missingCells({ "night/smug": 1 }, "day");
  assert.equal(cells.length, 10);
  assert.deepEqual(cells[0], { kind: "full", expr: "smug" });
  assert.deepEqual(cells[1], { kind: "bust", expr: "smug" });
});

test("requestSeq: only the latest response applies; busy while any request is out", () => {
  const q = requestSeq();
  assert.equal(q.busy(), false);
  const a = q.start(), b = q.start();
  assert.equal(q.busy(), true);
  assert.equal(q.done(b), true);   // newest lands first: applied
  assert.equal(q.done(a), false);  // older lands late: dropped
  assert.equal(q.busy(), false);
  const c = q.start();
  assert.equal(q.done(c), true);
});

test("deltaChips: signed value/cap labels, zeros and empties skipped, slider order", () => {
  assert.deepEqual(deltaChips({ heat: { cap: -1 }, brat: { value: 2, cap: 0 } }), ["brat +2", "heat cap −1"]);
  assert.deepEqual(deltaChips({ bimbo: { value: -3, cap: 1 } }), ["bimbo −3", "bimbo cap +1"]);
  assert.deepEqual(deltaChips(undefined), []);
  assert.deepEqual(deltaChips({ length: {} }), []);
});
test("groupBottles: by name (case-insensitive), ids oldest first, counts, sorted by name", () => {
  const b = (id: number, name: string) => ({ id, name, color: "#ffffff", effect: "e" });
  const g = groupBottles([b(3, "Zest"), b(1, "amber"), b(2, "Zest"), b(4, "zest ")]);
  assert.deepEqual(g.map((x) => [x.name, x.ids, x.count]), [["amber", [1], 1], ["Zest", [2, 3, 4], 3]]);
  assert.deepEqual(groupBottles([]), []);
});
test("poisonTone: none / poisoned purple / severe deep purple", () => {
  assert.equal(poisonTone(0), "#4b5563");
  assert.equal(poisonTone(1), "#9333ea");
  assert.equal(poisonTone(2), "#581c87");
});
test("stripVialBlock: removes fenced vial blocks, keeps the prose", () => {
  assert.equal(stripVialBlock('Here~\n\n```vial\n{"name":"x"}\n```\n\nEnjoy.'), "Here~\n\nEnjoy.");
  assert.equal(stripVialBlock("no block"), "no block");
  assert.equal(stripVialBlock("half\n```vial\n{\"na"), "half"); // still streaming: hide the open block
});

test("stripVialBlock: hides a bare opening fence before its newline arrives", () => {
  assert.equal(stripVialBlock("brewing~\n```vial"), "brewing~");
  assert.equal(stripVialBlock("brewing~\n```vial  "), "brewing~");
});
test("vialOutcome: valid vial, fumbled (cut off or invalid), nothing while streaming or without a block", () => {
  const ok = 'Here\n```vial\n{"name":"Brat Brew","color":"#ff00aa","effect":"sassy"}\n```';
  assert.deepEqual(vialOutcome(ok, true), { kind: "vial", vial: { name: "Brat Brew", color: "#ff00aa", effect: "sassy" } });
  assert.deepEqual(vialOutcome('Here\n```vial\n{"name":"Brat', true), { kind: "fumbled" }); // cut off, no closing fence
  assert.deepEqual(vialOutcome('```vial\n{"name":"x","color":"red","effect":"e"}\n```', true), { kind: "fumbled" }); // invalid
  assert.deepEqual(vialOutcome("```vial", true), { kind: "fumbled" });
  assert.equal(vialOutcome('Here\n```vial\n{"name":"Brat', false), null); // still streaming
  assert.equal(vialOutcome("just talk", true), null);
});
test("bottledKey: same thread + same vial → same key; differs by vial or thread", () => {
  const v = { name: "A", color: "#000000", effect: "e" };
  assert.equal(bottledKey(1, v), bottledKey(1, { ...v }));
  assert.notEqual(bottledKey(1, v), bottledKey(1, { ...v, effect: "f" }));
  assert.notEqual(bottledKey(1, v), bottledKey(2, v));
});

test("missingPoseCells: a pose = outfits x expressions (back: one per outfit); an outfit = every pose", () => {
  const none = {};
  assert.equal(missingPoseCells(none, { pose: "stand" }).length, 27);
  assert.deepEqual(missingPoseCells(none, { pose: "back" }).map((c) => c.outfit), ["day", "night", "lewd"]);
  assert.equal(missingPoseCells(none, { outfit: "day" }).length, 7 * 9 + 1);
  const have = { "pose/stand/day/smug": 1, "pose/back/night": 1 };
  const s = missingPoseCells(have, { pose: "stand", outfit: "day" });
  assert.equal(s.length, 8);
  assert.ok(!s.some((c) => c.expr === "smug"));
  assert.equal(missingPoseCells(have, { pose: "back" }).length, 2);
  assert.deepEqual(missingPoseCells({ ...Object.fromEntries(EXPRESSIONS.flatMap((e) => ["day", "night", "lewd"].map((o) => [`pose/sit/${o}/${e}`, 1]))) }, { pose: "sit" }), []);
  assert.deepEqual(missingPoseCells(none, { pose: "lie", outfit: "night" }).map((c) => c.expr), [...EXPRESSIONS]);
  assert.deepEqual(missingPoseCells(none, { outfit: "lewd" }).slice(0, 2).map((c) => `${c.pose}/${c.expr}`), ["stand/smug", "stand/laughing"]);
});

test("singleFlight: overlapping calls share one run; a later call runs again", async () => {
  let runs = 0;
  const f = singleFlight(async () => { runs++; await new Promise((r) => setTimeout(r, 5)); return runs; });
  const [a, b] = await Promise.all([f(), f()]);
  assert.equal(runs, 1);
  assert.equal(a, b);
  assert.equal(await f(), 2);
  const bad = singleFlight(async () => { throw new Error("x"); });
  await assert.rejects(bad());
  await assert.rejects(bad()); // a failure doesn't wedge it
});

test("historyForRegenerate: drops the trailing reply and error bubbles; needs a user message left", () => {
  const u = (content: string) => ({ role: "user" as const, content }), a = (content: string, error?: boolean) => ({ role: "assistant" as const, content, error });
  assert.deepEqual(historyForRegenerate([u("hi"), a("x"), u("more"), a("y")]), [u("hi"), a("x"), u("more")]);
  assert.deepEqual(historyForRegenerate([u("hi"), a("⚠️ no", true)]), [u("hi")]);
  assert.equal(historyForRegenerate([]), null);
  assert.equal(historyForRegenerate([u("hi")]), null);
});
test("historyForEdit: truncates at the user message, swaps the text, rejects blank or non-user", () => {
  const u = (content: string) => ({ role: "user" as const, content }), a = (content: string) => ({ role: "assistant" as const, content });
  const ms = [u("one"), a("A"), u("two"), a("B")];
  assert.deepEqual(historyForEdit(ms, 2, " fixed "), [u("one"), a("A"), u("fixed")]);
  assert.deepEqual(historyForEdit(ms, 0, "x"), [u("x")]);
  assert.equal(historyForEdit(ms, 1, "x"), null);
  assert.equal(historyForEdit(ms, 2, "  "), null);
  assert.equal(historyForEdit(ms, 9, "x"), null);
});

import { clipBatch, dragMask, missingClipKinds, resizeMask, spriteKeys } from "./ui";
test("missingClipKinds: playable kinds absent from the listing, spec order", () => {
  assert.deepEqual(missingClipKinds({}, "day/smug"), ["blink", "talk", "laugh", "pout", "wink", "wave", "jump"]);
  assert.deepEqual(missingClipKinds({ "day/smug": { blink: 1, talk: 2, jump: 4 } }, "day/smug"), ["laugh", "pout", "wink", "wave"]);
  assert.deepEqual(missingClipKinds({}, "pose/back/day"), []);
  assert.deepEqual(missingClipKinds({}, "pose/lie/day/smug"), ["laugh", "pout", "wink", "wave", "jump"]);
  assert.deepEqual(missingClipKinds({}, "pose/lie/day/smug", true), ["blink", "laugh", "pout", "wink", "wave", "jump"]);
});
test("spriteKeys/clipBatch: busts, poses, portraits; blink and talk first; only saved sprites and missing playable kinds", () => {
  const sprites = { "day/smug": 1, "day/full": 1, "pose/sit/day/smug": 1, "pose/legs/day/smug": 1, "talk/day/talk_open": 1, "talk/day/smug": 1, "night/smug": 1 };
  assert.deepEqual(spriteKeys(sprites, "day"), ["day/full", "day/smug", "pose/sit/day/smug", "pose/legs/day/smug", "talk/day/smug", "talk/day/talk_open"]);
  assert.deepEqual(spriteKeys(sprites, "day", true), ["talk/day/smug", "talk/day/talk_open"]);
  const b = clipBatch(sprites, { "day/full": { blink: 1 } }, "day");
  assert.deepEqual(b.slice(0, 3), [{ baseKey: "day/full", kind: "laugh" }, { baseKey: "day/full", kind: "pout" }, { baseKey: "day/full", kind: "wink" }]);
  assert.equal(b.length, 5 + 7 + 6 + 5 + 7); // full (no talk, blink done), bust, sit (no talk), legs (no talk/blink), talk/smug; talk_open none
  assert.equal(b.some((c) => c.baseKey === "talk/day/talk_open" || (c.baseKey.startsWith("pose/") && c.kind === "talk")), false);
  assert.equal(clipBatch(sprites, {}, "day", false, { "pose/legs/day/smug": { masks: { eyes: { x: 0, y: 0, w: 0.1, h: 0.1 } } } }).length, 6 + 7 + 6 + 6 + 7);
  assert.deepEqual(clipBatch(sprites, {}, "day", true).map((c) => c.kind).slice(0, 2), ["blink", "talk"]);
});
test("dragMask/resizeMask: clamped inside the sprite, min size 0.02", () => {
  const m = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
  assert.deepEqual(dragMask(m, 0.1, -0.1), { x: 0.5, y: 0.3, w: 0.2, h: 0.1 });
  assert.deepEqual(dragMask(m, 5, 5), { x: 0.8, y: 0.9, w: 0.2, h: 0.1 });
  assert.deepEqual(dragMask(m, -5, -5), { x: 0, y: 0, w: 0.2, h: 0.1 });
  assert.deepEqual(resizeMask(m, 0.1, 0.1), { x: 0.4, y: 0.4, w: 0.3, h: 0.2 });
  assert.deepEqual(resizeMask(m, -5, -5), { x: 0.4, y: 0.4, w: 0.02, h: 0.02 });
  assert.deepEqual(resizeMask(m, 5, 5), { x: 0.4, y: 0.4, w: 0.6, h: 0.6 });
});
