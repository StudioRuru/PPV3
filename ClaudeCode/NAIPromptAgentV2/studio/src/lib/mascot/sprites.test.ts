import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { candidatePath, listSprites, perImage, pick, saveCandidates, spritePath, spriteRequest, target } from "./sprites";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mascot-"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1]);

test("spriteRequest bust: char + constant + layer + expression + bust framing, 1024², 28 steps, per-layer seed, no ref", () => {
  const { compiled, params } = spriteRequest("night", "bust", "pout", S);
  assert.equal(compiled.base, [S.charTags, S.constantTags, S.layerTags.night, S.exprTags.pout, "portrait, upper body, looking at viewer, simple background, white background"].join(", "));
  assert.deepEqual(compiled.chars, []);
  assert.equal(compiled.uc, "");
  assert.equal(compiled.rating, "nsfw");
  assert.equal(params.width, 1024);
  assert.equal(params.height, 1024);
  assert.equal(params.steps, 28);
  assert.equal(params.seed, 2002);
  assert.equal(spriteRequest("night", "bust", "pout", S, 2).params.seed, 2004);
  assert.equal(spriteRequest("day", "bust", "smug", S).params.seed, 1001);
  assert.equal(spriteRequest("lewd", "bust", "smug", S).params.seed, 3003);
  assert.ok(!("ref" in params) && !("reference" in params));
});

test("spriteRequest full: full-body framing, no expression tags, 832×1216", () => {
  const { compiled, params } = spriteRequest("day", "full", "pout", S);
  assert.equal(compiled.base, [S.charTags, S.constantTags, S.layerTags.day, "full body, standing, hand on hip, looking at viewer, simple background, white background"].join(", "));
  assert.ok(compiled.base.includes("white background"));
  assert.ok(!compiled.base.includes(S.exprTags.pout));
  assert.equal(params.width, 832);
  assert.equal(params.height, 1216);
  assert.equal(params.steps, 28);
});

test("perImage: free at ≤1 Mpx and ≤28 steps, else unknown", () => {
  assert.equal(perImage(spriteRequest("day", "bust", "smug", S).params), 0);
  assert.equal(perImage(spriteRequest("day", "full", "smug", S).params), 0);
  assert.equal(perImage({ ...spriteRequest("day", "full", "smug", S).params, steps: 29 }), null);
  assert.equal(perImage({ ...spriteRequest("day", "full", "smug", S).params, width: 1216, height: 1216 }), null);
});

test("name whitelist rejects traversal and unknown names", () => {
  const d = "/x";
  assert.equal(spritePath(d, "day", "smug"), path.join(d, "day", "smug.png"));
  assert.equal(spritePath(d, "lewd", "full"), path.join(d, "lewd", "full.png"));
  for (const [o, n] of [["..", "smug"], ["day", "../smug"], ["day", "smug.png"], ["day/..", "smug"], ["evil", "smug"], ["day", "angry"], ["day", ""]]) {
    assert.equal(spritePath(d, o, n), null, `${o}/${n}`);
  }
  assert.equal(candidatePath(d, "day", "smug", 0), path.join(d, "candidates", "day", "smug", "0.png"));
  for (const i of [-1, 4, 1.5, NaN]) assert.equal(candidatePath(d, "day", "smug", i), null);
  assert.equal(candidatePath(d, "day", "../x", 0), null);
});

test("target parses outfit/kind/expr; full ignores expr; bad input null", () => {
  assert.deepEqual(target({ outfit: "day", kind: "bust", expr: "wink" }), { outfit: "day", kind: "bust", expr: "wink", name: "wink" });
  assert.deepEqual(target({ outfit: "night", kind: "full", expr: "nope" }), { outfit: "night", kind: "full", expr: "smug", name: "full" });
  assert.deepEqual(target({ outfit: "day", expr: "wink" }), { outfit: "day", kind: "bust", expr: "wink", name: "wink" });
  assert.equal(target({ outfit: "day", kind: "bust", expr: "../x" }), null);
  assert.equal(target({ outfit: "x", kind: "bust", expr: "wink" }), null);
  assert.equal(target(null), null);
});

test("pick never writes when the candidate is missing", async () => {
  const d = tmp();
  let called = false;
  const r = await pick(d, "day", "smug", 0, async () => { called = true; return new Response(PNG); });
  assert.ok("error" in r);
  assert.equal(called, false);
  assert.equal(fs.existsSync(path.join(d, "day")), false);
});

test("pick saves cutout + .orig, or keeps original with a note when cutout fails", async () => {
  const d = tmp();
  saveCandidates(d, "day", "smug", [PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 9])]);
  const cut = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 7]);
  let sent: FormData | null = null;
  const ok = await pick(d, "day", "smug", 0, async (_u, init) => { sent = init?.body as FormData; return new Response(cut, { headers: { "Content-Type": "image/png" } }); });
  assert.deepEqual(ok, { ok: true });
  assert.ok((sent as FormData | null)?.get("file") instanceof Blob);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.png")), cut);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.orig.png")), PNG);

  const down = await pick(d, "day", "smug", 1, async () => { throw new Error("ECONNREFUSED"); });
  assert.ok("note" in down && down.ok);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.png")), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 9]));

  const bad = await pick(d, "day", "smug", 0, async () => new Response("nope", { status: 500 }));
  assert.ok("note" in bad);
  assert.deepEqual(fs.readFileSync(path.join(d, "day", "smug.png")), PNG);
});

test("saveCandidates replaces the old batch; listSprites reports sprites (mtime) and sheets", () => {
  const d = tmp();
  saveCandidates(d, "night", "full", [PNG, PNG, PNG]);
  saveCandidates(d, "night", "full", [PNG]);
  assert.deepEqual(fs.readdirSync(path.join(d, "candidates", "night", "full")), ["0.png"]);
  fs.mkdirSync(path.join(d, "day"), { recursive: true });
  fs.writeFileSync(path.join(d, "day", "smug.png"), PNG);
  fs.writeFileSync(path.join(d, "day", "smug.orig.png"), PNG);
  fs.writeFileSync(path.join(d, "day", "evil.png"), PNG);
  fs.mkdirSync(path.join(d, "sheets"));
  fs.writeFileSync(path.join(d, "sheets", "lewd.png"), PNG);
  const l = listSprites(d);
  assert.deepEqual(Object.keys(l.sprites), ["day/smug"]);
  assert.equal(typeof l.sprites["day/smug"], "number");
  assert.deepEqual(l.sheets, { day: false, night: false, lewd: true });
  assert.deepEqual(listSprites(path.join(d, "missing")), { sprites: {}, sheets: { day: false, night: false, lewd: false } });
});
