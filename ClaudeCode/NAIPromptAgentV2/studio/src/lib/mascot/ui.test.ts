import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSIONS } from "./core";
import { composerBottom, cooldownLabel, cooldownToSlider, COOLDOWN_STEPS, deltaChips, diffTags, groupBottles, missingCells, nearestCorner, poisonTone, requestSeq, sliderToCooldown, stripVialBlock, vialOutcome, bottledKey } from "./ui";

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
test("composerBottom: tab bar + tallest visible composer + gap; fallback when none", () => {
  const fb = "calc(env(safe-area-inset-bottom) + 8.5rem)";
  assert.equal(composerBottom([]), fb);
  assert.equal(composerBottom([0, 0]), fb); // display:none composers measure 0
  assert.equal(composerBottom([0, 100, 72]), "calc(env(safe-area-inset-bottom) + 3.5rem + 100px + 0.5rem)");
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
