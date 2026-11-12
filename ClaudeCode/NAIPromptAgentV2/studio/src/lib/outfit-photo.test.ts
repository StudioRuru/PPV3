import assert from "node:assert/strict";
import { test } from "node:test";
import { outfitFromTags } from "./outfit-photo";

test("outfitFromTags merges photos, drops non-clothing, buckets by slot", () => {
  const g = (name: string, score: number) => ({ name, score, category: "general" });
  const stems = new Map([["black thighhighs", "footwear"], ["latex", "materials"], ["long hair", "appearance"], ["white shirt", "clothing"]]);
  const o = outfitFromTags([
    { tags: [g("white_shirt", 0.9), g("long_hair", 0.95), g("pleated_skirt", 0.5), g("choker", 0.2)], threshold: 0.35 },
    { tags: [g("black_thighhighs", 0.8), g("latex", 0.6), g("loafers", 0.7), g("white_shirt", 0.4)], threshold: 0.35 },
  ], stems);
  assert.deepEqual(o.tops, ["white shirt"]);
  assert.deepEqual(o.bottoms, ["pleated skirt"]);
  assert.deepEqual(o.legwear, ["black thighhighs"]);
  assert.deepEqual(o.footwear, ["loafers"]);
  assert.deepEqual(o.materials, ["latex"]);
  assert.deepEqual(o.accessories, []); // choker under threshold
});

test("slotOf: clothing states and body parts", async () => {
  const { slotOf } = await import("./outfit-photo");
  assert.equal(slotOf("leotard_pull", "states"), "states");
  assert.equal(slotOf("leotard aside", undefined), "states");
  assert.equal(slotOf("collarbone", "nudity"), null);
  assert.equal(slotOf("o-ring collar", undefined), "accessories");
  assert.equal(slotOf("thigh strap", "footwear"), "legwear");
});
