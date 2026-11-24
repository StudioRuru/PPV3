import test from "node:test";
import assert from "node:assert/strict";
import { resolveModel, splitSceneStream } from "./scene-ui";

test("splitSceneStream splits on the first NUL", () => {
  const r = splitSceneStream('hello\n\u0000{"out":{"target":"anime","prompt":"x","loras":[]},"dropped":["a"]}');
  assert.equal(r.prose, "hello");
  assert.equal(r.out?.prompt, "x");
  assert.deepEqual(r.dropped, ["a"]);
});
test("splitSceneStream tolerates errors and bad json", () => {
  assert.deepEqual(splitSceneStream("\n\n⚠️ boom"), { prose: "⚠️ boom", out: null, dropped: [] });
  assert.equal(splitSceneStream("hi\n\u0000{nope").out, null);
  assert.equal(splitSceneStream('hi\n\u0000{"out":null,"dropped":[]}').out, null);
});
test("splitSceneStream drops the json fence from prose", () => {
  const r = splitSceneStream('Here it is.\n```json\n{"prompt":"x"}\n```\n\u0000{"out":null,"dropped":[]}');
  assert.equal(r.prose, "Here it is.");
});
test("resolveModel matches case-insensitively else falls back", () => {
  assert.equal(resolveModel("wai", ["a.safetensors", "WAI-illustrious.safetensors"], "a.safetensors"), "WAI-illustrious.safetensors");
  assert.equal(resolveModel("krea2", ["a.safetensors"], "a.safetensors"), "a.safetensors");
});
