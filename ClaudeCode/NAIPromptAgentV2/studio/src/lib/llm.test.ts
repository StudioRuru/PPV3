import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { toModelImage } from "./llm";

test("toModelImage shrinks big images to about 1 Mpx JPEG and rejects non-images", async () => {
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#808080" } }).png().toBuffer();
  const url = await toModelImage(big);
  assert.match(url, /^data:image\/jpeg;base64,/);
  const meta = await sharp(Buffer.from(url.split(",")[1], "base64")).metadata();
  assert.ok(meta.width! * meta.height! <= 1_048_576 * 1.01);
  await assert.rejects(toModelImage(Buffer.from("not an image")));
});

test("review: EXIF-rotated portrait keeps its portrait shape uncropped", async () => {
  const stored = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#808080" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const url = await toModelImage(stored);
  const meta = await sharp(Buffer.from(url.split(",")[1], "base64")).metadata();
  assert.ok(meta.height! > meta.width!, `${meta.width}x${meta.height}`);
  assert.ok(Math.abs(meta.width! / meta.height! - 0.75) < 0.01);
});

test("focusQuery: the user's focus steers ToriiGate; tags ground it; no focus = the normal long caption", async () => {
  const { focusQuery, toriiQuery } = await import("./llm");
  assert.equal(focusQuery("1girl, armor", ""), toriiQuery("1girl, armor"));
  const q = focusQuery("1girl, broken armor", "how exactly is the armor broken?");
  assert.match(q, /how exactly is the armor broken\?/);
  assert.match(q, /\[1girl, broken armor\]/);
  assert.match(q, /Focus/);
});

test("chatBody: heavy calls turn thinking off (Gemma 4 APEX otherwise spends the whole reply budget thinking)", async () => {
  const { chatBody } = await import("./llm");
  const heavy = chatBody("", [{ role: "user", content: "hi" }], { model: "gemma4-26b-apex:latest", options: { num_predict: 220 }, system: false });
  assert.equal(heavy.think, false);
  assert.equal(heavy.model, "gemma4-26b-apex:latest");
  assert.deepEqual(heavy.messages, [{ role: "user", content: "hi" }]);
  assert.equal((heavy.options as { num_predict: number }).num_predict, 220);
  const everyday = chatBody("SYS", [{ role: "user", content: "hi" }]);
  assert.equal(everyday.think, undefined);
  assert.equal((everyday.messages as { role: string }[])[0].role, "system");
});
