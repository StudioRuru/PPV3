import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MASCOT_SETTINGS as S } from "../mascot/settings";
import { ANGLES, SHOTS, captionFor, nextIndex, picksPayload, trainsetRenders } from "./trainset";

test("caption drops identity, keeps expression's own fang", () => {
  const c = captionFor(S, "day", "smug", "portrait", "straight-on");
  assert.ok(c.startsWith("miyabi_sprite, "));
  assert.ok(!c.includes("hoshimi miyabi") && !c.includes("red eyes"));
  assert.ok(c.includes("smirk") && c.includes("fang"));
});
test("renders cover all outfits and expressions in 90", () => {
  const r = trainsetRenders(S, 0, 90);
  assert.equal(new Set(r.map((x) => x.outfit)).size, 3);
  assert.equal(new Set(r.map((x) => x.tags.split(", ").find((t) => SHOTS.includes(t)))).size, 4);
  assert.equal(new Set(r.map((x) => x.tags.split(", ").find((t) => ANGLES.includes(t)))).size, 4);
});
test("no age words anywhere", () => trainsetRenders(S, 0, 90).forEach((x) => assert.doesNotMatch(x.tags + x.caption, /\b(loli|child|young|teen|petite|aged?)\b/i)));
test("nextIndex resumes after the highest render", () => { assert.equal(nextIndex([]), 0); assert.equal(nextIndex(["000.png", "007.png", "007.txt", "picked.json"]), 8); });
test("picksPayload refuses 4 picks, reads 5 with captions", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ts-"));
  for (let i = 0; i < 5; i++) { fs.writeFileSync(path.join(d, `00${i}.png`), "x"); fs.writeFileSync(path.join(d, `00${i}.txt`), `cap${i}`); }
  fs.writeFileSync(path.join(d, "picked.json"), "[0,1,2,3]");
  await assert.rejects(picksPayload(d), /Pick 5–40/);
  fs.writeFileSync(path.join(d, "picked.json"), "[0,1,2,3,4]");
  const p = await picksPayload(d);
  assert.deepEqual(p.captions, ["cap0", "cap1", "cap2", "cap3", "cap4"]);
  assert.equal(p.images.length, 5);
});
test("null cost adds nothing and keeps the price gate closed; a measured cost, even 0, opens it", async () => {
  const { addSpent, readPer, readSpent, renderRefusal } = await import("./trainset");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ts-"));
  await addSpent(null, d);
  assert.equal(await readSpent(d), 0);
  assert.equal(await readPer(d), null);
  assert.equal((await renderRefusal(89, 1, d))?.status, 409);
  await addSpent(0, d);
  assert.equal(await readPer(d), 0);
  assert.equal(await renderRefusal(89, 1, d), null);
  await addSpent(7, d);
  assert.equal(await readPer(d), 7);
  assert.equal(await renderRefusal(89, 1, d), null);
  assert.equal(await renderRefusal(1, 0, d), null);
  assert.equal((await renderRefusal(50, 60, d))?.status, 400);
});
test("corrupt spent.json reads as defaults", async () => {
  const { readSpent } = await import("./trainset");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ts-"));
  fs.writeFileSync(path.join(d, "spent.json"), "{oops");
  assert.equal(await readSpent(d), 0);
});
