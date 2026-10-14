import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { zipStream } from "./zip-stream";

test("zipStream streams entries one at a time into a valid stored zip", async () => {
  const big = new Uint8Array(300_000).map((_, i) => i % 251);
  async function* entries() {
    yield { name: "a.png", data: big };
    yield { name: "recipes.json", data: new TextEncoder().encode('[{"id":1}]') };
  }
  const buf = new Uint8Array(await new Response(zipStream(entries())).arrayBuffer());
  const files = unzipSync(buf);
  assert.deepEqual(Object.keys(files), ["a.png", "recipes.json"]);
  assert.deepEqual(files["a.png"], big);
  assert.equal(new TextDecoder().decode(files["recipes.json"]), '[{"id":1}]');
});
