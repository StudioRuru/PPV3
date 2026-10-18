import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { migrate, addItem } from "../comfy/store";
import { cell, migrateSprites, addTake, linkTakeItem, approve } from "./store";
import { cutClip } from "./cutout";

let db: Database.Database;
const tmp: string[] = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "cut-")); tmp.push(d); return d; };
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { db = new Database(":memory:"); migrate(db); migrateSprites(db); });

const png = (w = 100, h = 200) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
function approved(from: string, to: string, surface: "chat" | "stage" = "chat") {
  const item = addItem(db, { kind: "clip", file: "a.mp4", poster: null, recipe: {}, seed: 1, cost: 0, createdAt: 0 });
  const c = cell(db, surface, "day", from, to);
  const t = addTake(db, c.id, 5, 1, {}); linkTakeItem(db, t, item); approve(db, c.id, t);
  return { c, t };
}
const fakeExtract = (n: number) => async (_mp4: string, out: string) => {
  const ps: string[] = [];
  for (let i = 0; i < n; i++) { const p = path.join(out, `${String(i + 1).padStart(3, "0")}.png`); fs.writeFileSync(p, await png()); ps.push(p); }
  return ps;
};
const cutOk = async (b: Buffer) => b;

test("cutClip writes webp frames + meta atomically", async () => {
  const { c, t } = approved("happy", "sad");
  const lib = mk();
  await cutClip(c.id, { db, dir: mk(), lib, extract: fakeExtract(3), cut: cutOk });
  const d = path.join(lib, "chat", "day", "happy~sad");
  assert.deepEqual(fs.readdirSync(d).sort(), ["000.webp", "001.webp", "002.webp", "meta.json"]);
  const meta = JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8"));
  assert.deepEqual(meta, { frames: 3, fps: 30, w: 360, h: 720, v: t });
  assert.equal((await sharp(path.join(d, "000.webp")).metadata()).width, 360);
  assert.equal(cell(db, "chat", "day", "happy", "sad").cut, "done");
  assert.deepEqual(fs.readdirSync(lib), ["chat"]);
});
test("stage frames are 480 wide", async () => {
  const { c } = approved("stand", "sit", "stage");
  const lib = mk();
  await cutClip(c.id, { db, dir: mk(), lib, extract: fakeExtract(1), cut: cutOk });
  assert.equal(JSON.parse(fs.readFileSync(path.join(lib, "stage", "day", "stand~sit", "meta.json"), "utf8")).w, 480);
});
test("a failed frame cut marks error and leaves no dir", async () => {
  const { c } = approved("happy", "sad");
  const lib = mk();
  let n = 0;
  await cutClip(c.id, { db, dir: mk(), lib, extract: fakeExtract(3), cut: async (b) => (++n === 2 ? null : b) });
  assert.equal(cell(db, "chat", "day", "happy", "sad").cut, "error");
  assert.deepEqual(fs.readdirSync(lib), []);
});
test("an idle drops nothing at cut time; meta.frames equals extracted count", async () => {
  const { c } = approved("happy", "happy");
  const lib = mk();
  await cutClip(c.id, { db, dir: mk(), lib, extract: fakeExtract(5), cut: cutOk });
  assert.equal(JSON.parse(fs.readFileSync(path.join(lib, "chat", "day", "happy~happy", "meta.json"), "utf8")).frames, 5);
  assert.equal(fs.readdirSync(path.join(lib, "chat", "day", "happy~happy")).length, 6);
});
