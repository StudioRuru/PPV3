import { test } from "node:test";
import assert from "node:assert/strict";
import { danbooruQuery, danbooruTags, keepTags, recreate } from "./recreate";
import { emptyState } from "./prompt";
import { DEFAULT_ENABLED, filterTags, type RawTag } from "./tagger";

const T = (name: string, category: string, group?: number, score = 0.9): RawTag => ({ name, category, score, group });
const tags = [
  T("hatsune_miku", "character"), T("vocaloid", "copyright"), T("1girl", "general", 0), T("aqua_hair", "general", 1),
  T("school_uniform", "general", 2), T("wet", "general", 3), T("sitting", "general", 4), T("smile", "general", 6),
  T("classroom", "general", 5), T("khazure", "style"), T("highres", "meta"), T("general", "rating"),
];
const lines = (ls: { text: string }[]) => ls.map((l) => l.text);

test("recreate lays tags out the V5 way: scene + style in Base, who/look/outfit/pose on Character 1", () => {
  const s = { ...emptyState(), uc: "my uc", rating: "safe" as const };
  const r = recreate(tags, s);
  assert.deepEqual(lines(r.base), ["1girl", "classroom"]);
  assert.deepEqual(lines(r.artists ?? []), ["artist:khazure"]);
  assert.equal(r.chars.length, 1);
  assert.deepEqual(lines(r.chars[0].lines), ["hatsune miku, vocaloid", "aqua hair", "school uniform, wet", "sitting, smile"]);
  assert.equal(r.uc, "my uc");
  assert.equal(r.rating, "safe");
  assert.equal(r.positions, "ai");
});

test("recreate with no character-level tags gives Base only, never an empty character box", () => {
  const r = recreate([T("no_humans", "general", 0), T("scenery", "general", 5)], emptyState());
  assert.deepEqual(lines(r.base), ["no humans", "scenery"]);
  assert.deepEqual(r.chars, []);
  assert.equal(recreate([], emptyState()).base.length, 1);
});

test("keepTags applies the same filter as filterTags but keeps categories", () => {
  const o = { thresholds: { general: 0.5 }, enabled: DEFAULT_ENABLED, exclude: ["wet"] };
  const kept = keepTags([...tags, T("blurry", "general", 6, 0.3)], o);
  assert.deepEqual(kept.map((t) => t.name).sort(), tags.filter((t) => !["wet", "highres", "general"].includes(t.name)).map((t) => t.name).sort());
  assert.equal(filterTags(tags, o).length, kept.filter(() => true).length);
});

test("danbooruTags maps a post's tag strings to categorised tags with YAML groups", () => {
  const post = { tag_string_character: "hatsune_miku", tag_string_copyright: "vocaloid", tag_string_artist: "khazure", tag_string_general: "1girl aqua_hair" };
  const r = danbooruTags(post, (n) => (n === "1girl" ? 0 : 1));
  assert.deepEqual(r.map((t) => [t.name, t.category, t.group]), [
    ["hatsune_miku", "character", undefined], ["vocaloid", "copyright", undefined], ["khazure", "style", undefined],
    ["1girl", "general", 0], ["aqua_hair", "general", 1],
  ]);
});

test("danbooruQuery turns typed tags + rating into a Danbooru search string", () => {
  assert.equal(danbooruQuery("hatsune miku, smile", "safe"), "hatsune_miku smile rating:g");
  assert.equal(danbooruQuery(" red hair ", "nsfw"), "red_hair rating:q,e");
  assert.equal(danbooruQuery("1girl", "off"), "1girl");
});

test("review: danbooruTags drops the tagger's default excludes (signature, text, …)", () => {
  const post = { tag_string_character: "", tag_string_copyright: "", tag_string_artist: "", tag_string_general: "1girl signature artist_name text smile" };
  assert.deepEqual(danbooruTags(post, () => 6).map((t) => t.name), ["1girl", "smile"]);
});

test("minor: Recreate keeps a boosted chip's weight", () => {
  const r = recreate([{ ...T("smile", "general", 6), weight: 1.15 }, T("1girl", "general", 0)], emptyState());
  assert.deepEqual(lines(r.chars[0].lines), ["1.15::smile::"]);
});
