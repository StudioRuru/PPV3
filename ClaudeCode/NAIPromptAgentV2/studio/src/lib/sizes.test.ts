import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceSize, matchPreset, PRESETS, ratioLabel, rotate } from "./sizes";

test("presets: NovelAI's portrait/landscape/square sizes, all multiples of 64", () => {
  assert.deepEqual(PRESETS.portrait.map((s) => [s.w, s.h]), [[512, 768], [832, 1216], [1024, 1536]]);
  assert.deepEqual(PRESETS.landscape.map((s) => [s.w, s.h]), [[768, 512], [1216, 832], [1536, 1024]]);
  assert.deepEqual(PRESETS.square.map((s) => [s.w, s.h]), [[640, 640], [1024, 1024], [1472, 1472]]);
  for (const list of Object.values(PRESETS)) for (const s of list) assert.ok(s.w % 64 === 0 && s.h % 64 === 0, `${s.w}×${s.h}`);
});

test("ratioLabel reduces to a familiar ratio", () => {
  assert.equal(ratioLabel(832, 1216), "2:3");
  assert.equal(ratioLabel(1024, 1024), "1:1");
  assert.equal(ratioLabel(1536, 1024), "3:2");
  assert.equal(ratioLabel(1216, 2624), "9:19.5");
});

test("deviceSize: native pixels rounded to 64 (portrait), wallpaper presets keep the device aspect", () => {
  assert.deepEqual(deviceSize(402, 874, 3), { w: 1216, h: 2624 });   // iPhone 17 Pro → 1206×2622 native
  // Bigger screens are scaled to fit NovelAI's 4 Mpx cap (aspect kept, sides rounded down to 64).
  const mac = deviceSize(1512, 982, 2), k5 = deviceSize(2560, 1440, 2);
  for (const s of [mac, k5]) assert.ok(s.w * s.h <= 4_194_304 && s.w % 64 === 0 && s.h % 64 === 0 && s.h > s.w, `${s.w}×${s.h}`);
  assert.ok(Math.abs(mac.h / mac.w - 3024 / 1964) < 0.05, "aspect kept");
  const wp = PRESETS.wallpaper;
  assert.ok(wp.every((s) => s.w % 64 === 0 && s.h % 64 === 0 && s.h > s.w));
});

test("rotate swaps; matchPreset finds an orientation + size, or Custom", () => {
  assert.deepEqual(rotate({ w: 832, h: 1216 }), { w: 1216, h: 832 });
  assert.deepEqual(matchPreset(832, 1216), { orientation: "portrait", size: "Medium" });
  assert.deepEqual(matchPreset(1216, 832), { orientation: "landscape", size: "Medium" });
  assert.deepEqual(matchPreset(900, 900), null);
});
