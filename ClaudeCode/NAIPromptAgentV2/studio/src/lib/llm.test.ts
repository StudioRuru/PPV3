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
