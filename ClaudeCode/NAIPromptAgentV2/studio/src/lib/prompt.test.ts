import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, emptyState, newLine, lineToText, parseToLines, splitTags } from "./prompt";

test("weighted line keeps its commas inside one run", () => {
  assert.equal(lineToText(newLine("rain, night", 1.2)), "1.2::rain, night::");
  assert.equal(lineToText(newLine("hat", -1)), "-1::hat::");
  assert.equal(lineToText(newLine("solo", 1)), "solo");
});

test("compile joins enabled lines, skips disabled and empty", () => {
  const s = emptyState();
  s.rating = "off";
  s.base = [newLine("1girl, solo"), { ...newLine("hidden"), enabled: false }, newLine("  "), newLine("smile", 1.15)];
  assert.equal(compile(s).base, "1girl, solo, 1.15::smile::");
});

test("character box with no enabled lines is dropped", () => {
  const s = emptyState();
  s.chars = [
    { id: "a", lines: [newLine("girl, red hair")], uc: "", enabled: true },
    { id: "b", lines: [{ ...newLine("boy"), enabled: false }], uc: "", enabled: true },
    { id: "c", lines: [newLine("girl")], uc: "", enabled: false },
  ];
  assert.deepEqual(compile(s).chars, [{ prompt: "girl, red hair", uc: "", center: undefined }]);
});

test("rating adds tags without duplicating user tags", () => {
  const s = emptyState();
  s.base = [newLine("1girl, nsfw")];
  s.rating = "nsfw";
  assert.equal(compile(s).base, "1girl, nsfw");
  s.rating = "safe";
  s.base = [newLine("1girl")];
  s.uc = "lowres";
  const c = compile(s);
  assert.equal(c.base, "1girl, rating:general");
  assert.equal(c.uc, "lowres, nsfw");
});

test("splitTags and parseToLines round-trip weighted runs", () => {
  assert.deepEqual(splitTags("a, 1.2::b, c::, d"), ["a", "1.2::b, c::", "d"]);
  const lines = parseToLines("1girl, 1.3::rain, night::, smile");
  assert.deepEqual(lines.map((l) => [l.text, l.weight]), [["1girl", undefined], ["rain, night", 1.3], ["smile", undefined]]);
});

test("hasContent ignores rating-only prompts", async () => {
  const { hasContent } = await import("./prompt");
  const s = emptyState();
  s.rating = "nsfw";
  assert.equal(compile(s).base, "nsfw");
  assert.equal(hasContent(s), false);
  s.base = [newLine("1girl")];
  assert.equal(hasContent(s), true);
});

test("positions: AI mode sends no centers, custom gives every character one", async () => {
  const { compile, emptyState, newLine } = await import("./prompt");
  const s = emptyState();
  s.rating = "off";
  s.base = [newLine("2girls")];
  s.chars = [
    { id: "a", lines: [newLine("girl")], uc: "", enabled: true, center: { x: 0.2, y: 0.4 } },
    { id: "b", lines: [newLine("girl")], uc: "", enabled: true },
  ];
  s.positions = "ai";
  assert.deepEqual(compile(s).chars.map((c) => c.center), [undefined, undefined]);
  s.positions = "custom";
  const centers = compile(s).chars.map((c) => c.center);
  assert.deepEqual(centers[0], { x: 0.2, y: 0.4 });
  assert.ok(centers[1] && centers[1].x > 0 && centers[1].x < 1, "unplaced char gets a default dot");
});

test("applyTags: base replace/append and new character creation", async () => {
  const { applyTags, emptyState, newLine } = await import("./prompt");
  const s = { ...emptyState(), base: [newLine("old")] };
  assert.deepEqual(applyTags(s, "base", "replace", "1girl, smile").base.map((l) => l.text), ["1girl, smile"]);
  assert.deepEqual(applyTags(s, "base", "append", "smile").base.map((l) => l.text), ["old", "smile"]);
  const withChar = applyTags(s, 2, "append", "girl, red hair");
  assert.equal(withChar.chars.length, 3);
  assert.deepEqual(withChar.chars[2].lines.map((l) => l.text), ["girl, red hair"]);
  assert.equal(s.chars.length, 0, "input state not mutated");
});

test("positionWords: side, height and size of a region", async () => {
  const { positionWords } = await import("./prompt");
  assert.equal(positionWords({ x: 0.2, y: 0.5, w: 0.3, h: 0.5 }), "on the left");
  assert.equal(positionWords({ x: 0.8, y: 0.2, w: 0.3, h: 0.3 }), "on the right, upper part of the image");
  assert.equal(positionWords({ x: 0.5, y: 0.8, w: 0.3, h: 0.3 }), "in the center, lower part of the image");
  assert.equal(positionWords({ x: 0.5, y: 0.5, w: 0.4, h: 0.9 }), "in the center, full body");
  assert.equal(positionWords({ x: 0.5, y: 0.5, w: 0.8, h: 0.7 }), "in the center, close-up");
  assert.equal(positionWords({ x: 0.3, y: 0.5, w: 0.15, h: 0.25 }), "on the left, small in frame, in the distance");
});

test("custom positions: characters go left→right by box, each with its position words; words can be turned off", async () => {
  const { compile, emptyState, newLine } = await import("./prompt");
  const s = emptyState();
  s.rating = "off";
  s.positions = "custom";
  s.base = [newLine("2girls")];
  s.chars = [
    { id: "a", lines: [newLine("red hair")], uc: "", enabled: true, region: { x: 0.8, y: 0.5, w: 0.3, h: 0.5 } },
    { id: "b", lines: [newLine("blue hair")], uc: "", enabled: true, region: { x: 0.2, y: 0.5, w: 0.3, h: 0.5 } },
  ];
  const c = compile(s).chars;
  assert.deepEqual(c.map((x) => x.prompt), ["blue hair, on the left", "red hair, on the right"]);
  assert.deepEqual(c.map((x) => x.center), [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]);
  assert.deepEqual(compile({ ...s, positionWords: false }).chars.map((x) => x.prompt), ["blue hair", "red hair"]);
  assert.deepEqual(compile({ ...s, positions: "ai" }).chars.map((x) => x.prompt), ["red hair", "blue hair"], "AI mode: box order, no words");
});

test("regionOf: an old centre-only character gets a default box around its dot", async () => {
  const { regionOf } = await import("./prompt");
  assert.deepEqual(regionOf({ id: "a", lines: [], uc: "", enabled: true, center: { x: 0.2, y: 0.4 } }, 0, 1), { x: 0.2, y: 0.4, w: 0.3, h: 0.6 });
  assert.equal(regionOf({ id: "a", lines: [], uc: "", enabled: true }, 1, 2).x, 0.67);
});

test("clampRegion keeps a box inside the canvas with a minimum size, never NaN", async () => {
  const { clampRegion } = await import("./prompt");
  assert.deepEqual(clampRegion({ x: 0.95, y: 0.5, w: 0.3, h: 0.4 }), { x: 0.85, y: 0.5, w: 0.3, h: 0.4 });
  assert.deepEqual(clampRegion({ x: 0.5, y: 0.5, w: 1.6, h: 0.01 }), { x: 0.5, y: 0.5, w: 1, h: 0.08 });
  assert.deepEqual(clampRegion({ x: NaN, y: -1, w: NaN, h: 0.2 }), { x: 0.5, y: 0.1, w: 0.3, h: 0.2 });
});

test("review: unplaced default boxes match the canvas (full-array index), words aren't added twice", async () => {
  const { compile, emptyState, newLine } = await import("./prompt");
  const s = emptyState();
  s.rating = "off"; s.positions = "custom"; s.base = [newLine("2girls")];
  s.chars = [
    { id: "a", lines: [], uc: "", enabled: true },
    { id: "b", lines: [newLine("blue hair")], uc: "", enabled: true },
  ];
  const [b] = compile(s).chars;
  assert.deepEqual(b.center, { x: 0.67, y: 0.5 });
  assert.equal(b.prompt, "blue hair, on the right");
  s.chars[1].lines = [newLine("blue hair, on the right")];
  assert.equal(compile(s).chars[0].prompt, "blue hair, on the right", "recipe already carries its words");
});

test("review: resizeRegion keeps the top-left corner fixed, even when clamped at the minimum", async () => {
  const { resizeRegion } = await import("./prompt");
  const from = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
  assert.deepEqual(resizeRegion(from, 0.1, 0.2), { x: 0.55, y: 0.6, w: 0.3, h: 0.4 });
  assert.deepEqual(resizeRegion(from, -0.5, -0.5), { x: 0.44, y: 0.44, w: 0.08, h: 0.08 });
});

test("website prompts: blank-line sections become lines, brace emphasis survives (commas inside braces too)", () => {
  const web = "1girl, nsfw, {{artist:Yabby,}} \n\n{{full body,}}\n\nmoral degeneration, public,\ntrain interior, standing, \n\nbest quality, [[blurry]], {a, b},,\n\n";
  assert.deepEqual(parseToLines(web).map((l) => l.text), [
    "1girl, nsfw, {{artist:Yabby}}", "{{full body}}", "moral degeneration, public, train interior, standing", "best quality, [[blurry]], {a, b}",
  ]);
  assert.deepEqual(splitTags("a, {{b, c}}, [d, e], f"), ["a", "{{b, c}}", "[d, e]", "f"]);
  assert.deepEqual(parseToLines("1girl, 1.3::rain, night::, smile").map((l) => [l.text, l.weight]), [["1girl", undefined], ["rain, night", 1.3], ["smile", undefined]]);
});

test("artist section: sent at the front of Base, artist: prefix added, weights (incl. negative) kept; old states fine", async () => {
  const { compile, emptyState, newLine } = await import("./prompt");
  const s = { ...emptyState(), rating: "off" as const, base: [newLine("1girl, smile")], artists: [newLine("ciloranko"), newLine("artist:wlop", -0.5), newLine("")] };
  assert.equal(compile(s).base, "artist:ciloranko, -0.5::artist:wlop::, 1girl, smile");
  const { artists: _, ...old } = s;
  assert.equal(compile(old).base, "1girl, smile");
});

test("splitArtists pulls artist tags (with {}/[] or numeric emphasis) out of lines", async () => {
  const { splitArtists, newLine } = await import("./prompt");
  const { base, artists } = splitArtists([newLine("1girl, nsfw, {{artist:Yabby}}"), newLine("artist:wlop"), newLine("rain", 1.2), newLine("0.8::artist:sho::")]);
  assert.deepEqual(base.map((l) => [l.text, l.weight]), [["1girl, nsfw", undefined], ["rain", 1.2]]);
  assert.deepEqual(artists.map((l) => [l.text, l.weight]), [["artist:Yabby", 1.1], ["artist:wlop", undefined], ["artist:sho", 0.8]]);
});
