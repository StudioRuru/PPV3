import { test } from "node:test";
import assert from "node:assert/strict";
import { beats } from "./recipe";
import { budget, naiToComfy, parseScene, cleanScene, videoSeconds, scenePrompt, TARGETS } from "./scene";

const ctx = { target: "anime" as const, known: new Set<string>(), loras: [] };

test("budget keeps 2 double and 6 single", () => {
  const t = ["{{a}}", "{{b}}", "{{c}}", "{d}", "{e}", "{f}", "{g}", "{h}", "{i}", "{j}", "k"];
  const out = budget(t);
  assert.equal(out.filter((x) => x.startsWith("{{")).length, 2);
  assert.equal(out.filter((x) => /^\{[^{]/.test(x)).length, 6);
  assert.equal(out.length, t.length);
});
test("naiToComfy converts weights", () => assert.equal(naiToComfy(["{{long_hair}}", "{smile}", "1girl"]), "(long hair:1.2), (smile:1.1), 1girl"));
test("parseScene takes last json block; malformed → null", () => {
  assert.deepEqual(parseScene("hi\n```json\n{\"a\":1}\n```\nmore\n```json\n{\"b\":2}\n```").out, { b: 2 });
  assert.equal(parseScene("x ```json\n{bad\n```").out, null);
  assert.equal(parseScene("no block").out, null);
});
test("cleanScene drops unknown tags and wrong-family LoRAs", () => {
  const r = cleanScene({ prompt: "1girl, {smile}, notatag", loras: [{ name: "sdxlA", strength: 2 }, { name: "wanB", strength: 1 }, { name: "ghost", strength: 1 }] },
    { target: "anime", known: new Set(["1girl", "smile"]), loras: [{ name: "sdxlA", family: "sdxl", words: ["trig"] }, { name: "wanB", family: "wan", words: [] }] })!;
  assert.deepEqual(r.out.loras, [{ name: "sdxlA", strength: 1.5 }]);
  assert.ok(r.out.prompt.includes("trig") && r.out.prompt.includes("(smile:1.1)") && !r.out.prompt.includes("notatag"));
  assert.deepEqual(r.dropped.sort(), ["ghost", "notatag", "wanB"]);
});
test("video beats align with beats() and seconds", () => {
  const r = cleanScene({ prompt: "", beats: [{ text: "She sits on the rooftop" }, { text: "She stands and her hair blows." }], loras: [] }, { target: "video", known: new Set(), loras: [] })!;
  assert.deepEqual(r.out.beats!.map((b) => [b.from, b.to]), [[0, 5], [5, 10]]);
  assert.deepEqual(beats(r.out.prompt, 2), ["She sits on the rooftop.", "She stands and her hair blows."]);
  assert.equal(videoSeconds(1), 5); assert.equal(videoSeconds(3), 10);
});
test("video drops beat 3+", () => {
  const r = cleanScene({ beats: [{ text: "a" }, { text: "b" }, { text: "c" }], loras: [] }, { ...ctx, target: "video" })!;
  assert.equal(r.out.beats!.length, 2);
  assert.deepEqual(r.dropped, ["beat 3+"]);
});
test("cleanScene returns null for non-object or empty prompt", () => { assert.equal(cleanScene("x", ctx), null); assert.equal(cleanScene({ prompt: " " , loras: [] }, { ...ctx, target: "photo" }), null); });
test("scenePrompt inlines refs, LoRAs and ends with revise rule", () => {
  const p = scenePrompt("anime", [{ name: "sdxlA", family: "sdxl", words: ["trig"] }, { name: "wanB", family: "wan", words: [] }], (f) => `REF:${f}`);
  assert.ok(p.includes("REF:tag-guide.md") && p.includes("sdxlA") && p.includes("trig") && !p.includes("wanB") && p.includes("```json"));
  assert.match(p, /revise the previous prompt/i);
  assert.equal(TARGETS.video.model, "wan");
});
