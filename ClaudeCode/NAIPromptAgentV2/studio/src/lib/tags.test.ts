import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, dots, parseDanbooruCsv, suggest, yamlTagNames } from "./tags";

const csv = `1girl,0,6008644,"1girls,sole_female"
red_hair,0,900000,"redhead"
red_eyes,0,1000000,""
hatsune_miku,4,150000,"miku"
artist_x,1,500,""`;

test("csv parse normalizes underscores and categories", () => {
  const e = parseDanbooruCsv(csv);
  assert.deepEqual(e[1], { name: "red hair", category: "general", count: 900000, aliases: ["redhead"], source: "danbooru" });
  assert.equal(e[3].category, "character");
  assert.equal(e[4].category, "artist");
});

test("yaml walk finds nested tag values", () => {
  const doc = { subcategories: { tops: { tags: [{ tag: "white shirt" }, { tag: "frilled shirt", aliases: ["x"] }] } } };
  assert.deepEqual(yamlTagNames(doc), ["white shirt", "frilled shirt"]);
});

test("suggest: prefix before contains, then count; aliases match", () => {
  const idx = buildIndex([...parseDanbooruCsv(csv), { name: "frilled shirt", category: "general", count: 0, aliases: [], source: "yaml" }]);
  assert.deepEqual(suggest(idx, "red").map((t) => t.name), ["red eyes", "red hair"]);
  assert.equal(suggest(idx, "redhead")[0].name, "red hair");
  assert.equal(suggest(idx, "shirt")[0].name, "frilled shirt");
  assert.deepEqual(suggest(idx, "  "), []);
});

test("knowledge dots", () => {
  assert.deepEqual([0, 999, 1000, 10000, 100000].map(dots), [0, 0, 1, 2, 3]);
});

test("yaml group rank: subject first, then appearance, clothing, pose, setting, other", async () => {
  const { yamlGroupRank } = await import("./tags");
  const groups = new Map([["red hair", "appearance"], ["school uniform", "clothing"], ["standing", "poses"], ["park", "settings"]]);
  const r = (n: string) => yamlGroupRank(n, groups);
  assert.deepEqual(["1girl", "solo", "red_hair", "school_uniform", "standing", "park", "smile"].map(r), [0, 0, 1, 2, 4, 5, 6]);
});
