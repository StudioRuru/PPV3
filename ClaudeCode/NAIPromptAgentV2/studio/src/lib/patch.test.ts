import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, opTags, parseReply } from "./patch";
import { compile, emptyState, newLine } from "./prompt";

const reply = (json: string) => `Here is a scene.\n\n\`\`\`json\n${json}\n\`\`\`\nEnjoy.`;

test("parseReply splits prose from the last fenced json ops block", () => {
  const r = parseReply(reply('{"ops":[{"target":"base","action":"add","line":"night, rain"}]}'));
  assert.equal(r.prose, "Here is a scene.\n\nEnjoy.");
  assert.deepEqual(r.ops, [{ target: "base", action: "add", line: "night, rain" }]);
  assert.equal(r.error, undefined);
});

test("parseReply: no block means prose only, broken json is an error, bad ops are dropped", () => {
  assert.deepEqual(parseReply("just talk"), { prose: "just talk", ops: [] });
  assert.match(parseReply(reply('{"ops":[{"target":')).error!, /couldn't read/i);
  const r = parseReply(reply('{"ops":[{"target":"char:x","action":"add","line":"a"},{"target":"uc","action":"explode","line":"b"},{"target":"char:1","action":"weight","line":"smile","weight":"big"},{"target":"char:0","action":"add","line":"smile"}]}'));
  assert.deepEqual(r.ops, [{ target: "char:0", action: "add", line: "smile" }]);
});

test("applyOps add/replace on base, chars (created when missing) and uc", () => {
  let s = emptyState();
  s = applyOps(s, [
    { target: "base", action: "add", line: "night, rain" },
    { target: "char:1", action: "add", line: "girl, red hair", weight: 1.15 },
    { target: "uc", action: "add", line: "text, mosaic censoring" },
  ]);
  const c = compile(s);
  assert.equal(c.base, "night, rain, nsfw");
  assert.equal(s.chars.length, 1);
  assert.equal(c.chars[0].prompt, "1.15::girl, red hair::");
  assert.match(s.uc, /cropped, text, mosaic censoring$/);
  s = applyOps(s, [{ target: "base", action: "replace", line: "beach" }, { target: "uc", action: "replace", line: "lowres" }]);
  assert.equal(compile(s).base, "beach, nsfw");
  assert.equal(s.uc, "lowres");
});

test("applyOps remove takes tags out of lines and drops emptied lines", () => {
  const s = { ...emptyState(), base: [newLine("night, rain, city"), newLine("rain")], uc: "lowres, text" };
  const out = applyOps(s, [{ target: "base", action: "remove", line: "rain" }, { target: "uc", action: "remove", line: "text" }]);
  assert.deepEqual(out.base.map((l) => l.text), ["night, city"]);
  assert.equal(out.uc, "lowres");
});

test("applyOps weight sets a whole-line weight or splits the tag out", () => {
  const s = { ...emptyState(), base: [newLine("smile"), newLine("night, rain")] };
  const out = applyOps(s, [{ target: "base", action: "weight", line: "smile", weight: 1.3 }, { target: "base", action: "weight", line: "rain", weight: 0.8 }]);
  assert.equal(compile(out).base, "1.3::smile::, night, 0.8::rain::, nsfw");
});

test("opTags returns short tags without weight syntax, skips sentences", () => {
  assert.deepEqual(opTags([{ target: "base", action: "add", line: "1.2::red hair::, a girl standing alone in the rain at night, smile" }]), ["red hair", "smile"]);
});

test("parseReply hides an unterminated json block while the reply streams", () => {
  assert.deepEqual(parseReply('A festival.\n\n```json\n{"ops":[{"target":'), { prose: "A festival.", ops: [] });
});

test("review: char:N past the end appends exactly one character (no runaway growth)", () => {
  const s = { ...emptyState(), chars: [{ id: "a", lines: [newLine("alice")], uc: "", enabled: true }] };
  assert.equal(applyOps(s, [{ target: "char:7", action: "add", line: "bob" }]).chars.length, 2);
  assert.equal(applyOps(s, [{ target: "char:99999999", action: "add", line: "bob" }]).chars.length, 2);
});

test("review: a mid-block failure keeps the trailing error line visible", () => {
  assert.deepEqual(parseReply('Scene.\n```json\n{"ops":[{"tar\n\n⚠️ unexpected EOF'), { prose: "Scene.\n\n⚠️ unexpected EOF", ops: [] });
});

test("review: inline weight syntax in an op line is unwrapped, op weight wins", () => {
  const out = applyOps(emptyState(), [
    { target: "base", action: "add", line: "1.2::red hair::", weight: 1.1 },
    { target: "base", action: "add", line: "0.8::smile::" },
  ]);
  assert.equal(compile(out).base, "1.1::red hair::, 0.8::smile::, nsfw");
});

test("polish: applying the same card twice doesn't duplicate added lines", () => {
  const ops = parseReply(reply('{"ops":[{"target":"base","action":"add","line":"night, rain"},{"target":"char:0","action":"add","line":"red hair"}]}')).ops;
  const once = applyOps(emptyState(), ops);
  assert.deepEqual(applyOps(once, ops), once);
});

test("polish: a ```JSON fence parses; a block with only invalid ops says so", () => {
  assert.equal(parseReply('ok\n```JSON\n{"ops":[{"target":"uc","action":"add","line":"blurry"}]}\n```').ops.length, 1);
  assert.match(parseReply(reply('{"ops":[{"target":"moon","action":"add","line":"x"}]}')).error ?? "", /no usable changes/i);
});

test("emphasis guard: at most 2 weighted adds, clamped to 0.8–1.3; explicit weight ops untouched", () => {
  const all = (w: number) => ["a", "b", "c", "d"].map((t) => ({ target: "base", action: "add", line: t, weight: w }));
  const r = parseReply(reply(JSON.stringify({ ops: [...all(1.2).slice(0, 3), { target: "base", action: "add", line: "x", weight: 1.9 }, { target: "char:0", action: "weight", line: "smile", weight: 1.6 }] })));
  assert.deepEqual(r.ops.map((o) => o.weight), [1.2, 1.2, undefined, undefined, 1.6]);
  assert.equal(parseReply(reply('{"ops":[{"target":"base","action":"replace","line":"y","weight":1.8}]}')).ops[0].weight, 1.3);
});

test("ops can target the artist section", () => {
  const s = applyOps(emptyState(), parseReply(reply('{"ops":[{"target":"artist","action":"add","line":"artist:ciloranko"}]}')).ops);
  assert.deepEqual(s.artists?.map((l) => l.text), ["artist:ciloranko"]);
});
