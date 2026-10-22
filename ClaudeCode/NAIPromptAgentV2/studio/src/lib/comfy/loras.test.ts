import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSafetensors, listLoras, loraName, saveLora, LoraError } from "./loras";

const st = (json: string) => { const h = Buffer.alloc(8); h.writeBigUInt64LE(BigInt(json.length)); return Buffer.concat([h, Buffer.from(json), Buffer.alloc(16)]); };
const body = (b: Buffer) => new Blob([new Uint8Array(b)]).stream();

test("loraName takes plain .safetensors names only", () => {
  assert.equal(loraName("my face v2 (qwen).safetensors"), "my face v2 (qwen).safetensors");
  for (const bad of ["../x.safetensors", "a/b.safetensors", ".hidden.safetensors", "x.ckpt", "it's.safetensors", "x.safetensors\n"]) assert.equal(loraName(bad), null, bad);
});

test("isSafetensors checks the header", () => {
  const ok = st('{"a":1}');
  assert.ok(isSafetensors(ok.subarray(0, 9), ok.length));
  assert.ok(!isSafetensors(Buffer.from("PK\x03\x04aaaaaaa"), 100));
  assert.ok(!isSafetensors(ok.subarray(0, 9), 10)); // header longer than the file
});

test("saveLora keeps real LoRAs and drops anything else", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loras-"));
  assert.equal(await saveLora("a.safetensors", body(st('{"w":0}')), dir), 31);
  await assert.rejects(saveLora("b.safetensors", body(Buffer.from("<html>nope</html>")), dir), LoraError);
  assert.deepEqual(await listLoras(dir), [{ name: "a.safetensors", bytes: 31 }]);
  assert.deepEqual(fs.readdirSync(dir), ["a.safetensors"]);
});
