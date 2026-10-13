import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ENABLED, DEFAULT_EXCLUDE, filterTags, toPromptTag, type RawTag } from "./tagger";

const tags: RawTag[] = [
  { name: "smile", category: "general", score: 0.9, group: 6 },
  { name: "1girl", category: "general", score: 0.99, group: 0 },
  { name: "red_hair", category: "general", score: 0.95, group: 1 },
  { name: "school_uniform", category: "general", score: 0.6, group: 2 },
  { name: "faint_tag", category: "general", score: 0.1, group: 6 },
  { name: "watermark", category: "general", score: 0.8, group: 6 },
  { name: "king_halo_(umamusume)", category: "character", score: 0.9 },
  { name: "umamusume", category: "copyright", score: 0.9 },
  { name: "ebifurya", category: "style", score: 0.5 },
  { name: "highres", category: "meta", score: 0.9 },
  { name: "rating:s", category: "rating", score: 0.8 },
];
const thresholds = { general: 0.17, character: 0.27, style: 0.15, copyright: 0.24, meta: 0.17, rating: 0.41 };

test("prompt form: spaces, parens kept, artists prefixed", () => {
  assert.equal(toPromptTag({ name: "king_halo_(umamusume)", category: "character", score: 1 }), "king halo (umamusume)");
  assert.equal(toPromptTag({ name: "ebifurya", category: "style", score: 1 }), "artist:ebifurya");
});

test("default filter: order character, copyright, general by group, then artists; meta/rating/excluded/below-threshold dropped", () => {
  const out = filterTags(tags, { thresholds, enabled: DEFAULT_ENABLED, exclude: DEFAULT_EXCLUDE });
  assert.deepEqual(out, ["king halo (umamusume)", "umamusume", "1girl", "red hair", "school uniform", "smile", "artist:ebifurya"]);
});

test("disabled category never leaks, incl. artists", () => {
  const out = filterTags(tags, { thresholds, enabled: { ...DEFAULT_ENABLED, style: false, character: false }, exclude: [] });
  assert.ok(!out.some((t) => t.startsWith("artist:") || t.includes("king halo")));
  assert.ok(out.includes("watermark"), "exclude list emptied → watermark allowed");
});

test("raising a slider drops lower-scoring tags", () => {
  const out = filterTags(tags, { thresholds: { ...thresholds, general: 0.92 }, enabled: DEFAULT_ENABLED, exclude: DEFAULT_EXCLUDE });
  assert.deepEqual(out.filter((t) => !t.includes("(") && !t.includes(":") && t !== "umamusume"), ["1girl", "red hair"]);
});
