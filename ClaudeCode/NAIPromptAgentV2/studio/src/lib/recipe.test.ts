import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import extract from "png-chunks-extract";
import encode from "png-chunks-encode";
import { encode as textChunk } from "png-chunk-text";
import { readRecipe, recipeToState } from "./recipe";

const comment = {
  prompt: "1girl, 1.3::rain, night::, artist:ciloranko",
  uc: "lowres",
  seed: 777, sampler: "k_euler_ancestral", steps: 28, scale: 5, width: 832, height: 1216,
  v4_prompt: { caption: { base_caption: "1girl, 1.3::rain, night::, artist:ciloranko", char_captions: [{ char_caption: "girl, red hair" }] } },
  v4_negative_prompt: { caption: { base_caption: "lowres", char_captions: [] } },
};

async function blankPng(alpha = false) {
  return sharp({ create: { width: 64, height: 64, channels: alpha ? 4 : 3, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
}

test("reads the tEXt Comment recipe", async () => {
  const chunks = extract(new Uint8Array(await blankPng()));
  chunks.splice(-1, 0, textChunk("Software", "NovelAI"), textChunk("Source", "NovelAI Diffusion V5 Full"), textChunk("Comment", JSON.stringify(comment)));
  const r = await readRecipe(Buffer.from(encode(chunks)));
  assert.ok(r);
  assert.equal(r.base, "1girl, 1.3::rain, night::, artist:ciloranko");
  assert.deepEqual(r.chars, ["girl, red hair"]);
  assert.equal(r.seed, 777);
  assert.deepEqual(r.artists, ["artist:ciloranko"]);
  const { state, params } = recipeToState(r);
  assert.equal(state.base.find((l) => l.weight === 1.3)?.text, "rain, night");
  assert.equal(state.chars.length, 1);
  assert.equal(params.seed, 777);
});

test("reads stealth alpha-LSB metadata", async () => {
  const w = 64, h = 64;
  const raw = Buffer.alloc(w * h * 4, 255);
  const payload = gzipSync(Buffer.from(JSON.stringify({ Comment: JSON.stringify(comment), Source: "NovelAI Diffusion V5 Full" })));
  const bytes = Buffer.concat([Buffer.from("stealth_pngcomp"), Buffer.alloc(4), payload]);
  bytes.writeUInt32BE(payload.length * 8, 15);
  let i = 0;
  for (const byte of bytes) for (let b = 7; b >= 0; b--, i++) {
    const x = Math.floor(i / h), y = i % h; // column-major, as NAI writes it
    raw[(y * w + x) * 4 + 3] = 254 | ((byte >> b) & 1);
  }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const r = await readRecipe(png);
  assert.equal(r?.seed, 777);
});

test("plain image returns null", async () => {
  assert.equal(await readRecipe(await blankPng(true)), null);
});

test("V5 recipe with coords restores custom positions", async () => {
  const withCoords = { ...comment, v4_prompt: { use_coords: true, caption: { base_caption: "2girls", char_captions: [
    { char_caption: "girl, red hair", centers: [{ x: 0.3, y: 0.5 }] }, { char_caption: "girl", centers: [{ x: 0.7, y: 0.5 }] }] } } };
  const chunks = extract(new Uint8Array(await blankPng()));
  chunks.splice(-1, 0, textChunk("Software", "NovelAI"), textChunk("Comment", JSON.stringify(withCoords)));
  const r = await readRecipe(Buffer.from(encode(chunks)));
  const { state } = recipeToState(r!);
  assert.equal(state.positions, "custom");
  assert.deepEqual(state.chars.map((c) => c.center), [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }]);
});
