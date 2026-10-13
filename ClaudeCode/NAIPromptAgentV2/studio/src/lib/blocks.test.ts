import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBlock, arcToBlocks, clusterToBlock, loadScene, outfitToBlock, slugify, themeToBlock } from "./blocks";
import { compile, emptyState, newLine } from "./prompt";

test("outfit block: union of tag lists, emphasized tags weighted", () => {
  const b = outfitToBlock("black-peplum", {
    name: "Black Peplum", tags: { tops: ["frilled shirt", "see-through"], legwear: ["white thighhighs"], materials: ["see-through"] },
    weight_overrides: { emphasized: ["white thighhighs"] },
  });
  assert.equal(b.id, "outfit:black-peplum");
  assert.deepEqual(b.char, ["frilled shirt", "see-through", "1.15::white thighhighs::"]);
});

test("theme block: effects to base, anchors+support to character, negatives to uc", () => {
  const b = themeToBlock("armor-break", {
    name: "Armor Break", base_layer: { effects: ["sparks", "debris"] },
    character_layer: { anchors: ["torn clothes"], support: ["armor"] },
    clean_cut_negatives: ["tattered"], safety_negatives: ["blood"], applies_to: "single-figure",
  });
  assert.deepEqual([b.base, b.char, b.uc], [["sparks", "debris"], ["torn clothes", "armor"], ["tattered", "blood"]]);
  const s = applyBlock({ ...emptyState(), rating: "off", base: [newLine("1girl")], chars: [{ id: "c", lines: [newLine("girl")], uc: "", enabled: true }] }, b, 0);
  const c = compile(s);
  assert.equal(c.base, "1girl, sparks, debris");
  assert.equal(c.chars[0].prompt, "girl, torn clothes, armor");
  assert.match(c.uc, /tattered, blood$/);
});

test("arc scenes become loadable blocks", () => {
  const [s1] = arcToBlocks("maru", { name: "Maru", scenes: [{ scene_number: 1, title: "Pole", prompt: { base: "1girl, 0.9::race track::", character: "girl, smile", undesired: "lowres" } }] });
  assert.equal(s1.name, "Maru · 1 Pole");
  const st = loadScene(s1);
  assert.deepEqual(st.base.map((l) => [l.text, l.weight]), [["1girl", undefined], ["race track", 0.9]]);
  assert.equal(st.chars.length, 1);
  assert.equal(st.uc, "lowres");
  assert.equal(st.positions, "ai");
});

test("cluster block keeps kind and sends to the chosen target", () => {
  const b = clusterToBlock("maid-set", { name: "maid set", kind: "theme", tags: ["maid", "maid headdress"] });
  assert.equal(b.kind, "theme");
  assert.ok(b.user);
  const s = applyBlock(emptyState(), b, "base");
  assert.deepEqual(s.base.filter((l) => l.text).map((l) => l.text), ["maid, maid headdress"]);
});

test("slugify rejects traversal and empties", () => {
  assert.equal(slugify("Maid Set!"), "maid-set");
  assert.equal(slugify("../x"), "x");
  assert.equal(slugify("💀"), null);
  assert.equal(slugify("   "), null);
});
