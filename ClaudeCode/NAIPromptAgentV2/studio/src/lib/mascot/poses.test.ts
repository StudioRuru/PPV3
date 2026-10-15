import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickPoseSprite, POSE_SPEC, POSES, poseKey } from "./poses";
import { DEFAULT_MASCOT_SETTINGS as S } from "./settings";
import { listSprites, pick, poseCandidatePath, posePath, poseRequest, saveCandidates, target } from "./sprites";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1]);

test("sizes per pose; every spec has a plain background", () => {
  const size = (p: (typeof POSES)[number]) => [POSE_SPEC[p].width, POSE_SPEC[p].height];
  for (const p of ["stand", "apose", "peek", "lean", "back"] as const) assert.deepEqual(size(p), [832, 1216]);
  assert.deepEqual(size("lie"), [1216, 832]);
  for (const p of ["sit", "legs"] as const) assert.deepEqual(size(p), [1024, 1024]);
  for (const p of POSES) assert.ok(POSE_SPEC[p].tags.includes("simple background, white background"));
  assert.ok(POSE_SPEC.lie.tags.includes("lying on stomach") && POSE_SPEC.back.tags.includes("from behind"));
});

test("poseRequest composes char + constant + layer + expression (faced) + pose tags, no bust UC", () => {
  const { compiled, params } = poseRequest("night", "lie", "pout", S, 7);
  assert.equal(compiled.base, [S.charTags, S.constantTags, S.layerTags.night, S.exprTags.pout, POSE_SPEC.lie.tags].join(", "));
  assert.equal(compiled.uc, "");
  assert.deepEqual([params.width, params.height, params.steps, params.seed], [1216, 832, 28, 7]);
  const back = poseRequest("day", "back", "pout", S);
  assert.equal(back.compiled.base, [S.charTags, S.constantTags, S.layerTags.day, POSE_SPEC.back.tags].join(", "));
});

test("paths: back has no expression and its own file; traversal rejected", () => {
  const d = "/x";
  assert.equal(posePath(d, "sit", "day", "wink"), path.join(d, "pose", "sit", "day", "wink.png"));
  assert.equal(posePath(d, "back", "day", null), path.join(d, "pose", "back", "day.png"));
  assert.equal(poseCandidatePath(d, "back", "day", null, 1), path.join(d, "candidates", "pose", "back", "day", "back", "1.png"));
  for (const [p, o, e] of [["../x", "day", "wink"], ["sit", "..", "wink"], ["sit", "day", "../wink"], ["sit", "day", null], ["evil", "day", "wink"], ["sit", "evil", "wink"]] as const) {
    assert.equal(posePath(d, p, o, e), null, `${p}/${o}/${e}`);
  }
  assert.equal(poseCandidatePath(d, "sit", "day", "wink", 4), null);
});

test("fallback chain: pose+expr, pose/smug, stand/expr, stand/smug, null", () => {
  const all = new Set([poseKey("sit", "day", "wink"), poseKey("sit", "day", "smug"), poseKey("stand", "day", "wink"), poseKey("stand", "day", "smug")]);
  const chain = ["pose/sit/day/wink", "pose/sit/day/smug", "pose/stand/day/wink", "pose/stand/day/smug"];
  for (const k of chain) {
    assert.equal(pickPoseSprite(all, "sit", "day", "wink"), k);
    all.delete(k);
  }
  assert.equal(pickPoseSprite(all, "sit", "day", "wink"), null);
});

test("back view ignores expression and falls through to stand", () => {
  assert.equal(pickPoseSprite(new Set(["pose/back/day", "pose/stand/day/smug"]), "back", "day", "pout"), "pose/back/day");
  assert.equal(pickPoseSprite(new Set(["pose/stand/day/pout"]), "back", "day", "pout"), "pose/stand/day/pout");
  assert.equal(pickPoseSprite(new Set(), "back", "day", "pout"), null);
});

test("target accepts pose; back drops expression; bad pose null", () => {
  assert.deepEqual(target({ outfit: "day", pose: "sit", expr: "wink" }), { outfit: "day", kind: "bust", expr: "wink", name: "wink", pose: "sit" });
  assert.equal(target({ outfit: "day", pose: "back" })?.pose, "back");
  assert.equal(target({ outfit: "day", pose: "sit", expr: "nope" }), null);
  assert.equal(target({ outfit: "day", pose: "../x", expr: "wink" }), null);
});

test("pose candidates → pick saves sprite + .orig; listing includes pose sprites", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mascot-"));
  saveCandidates(d, "day", "wink", [PNG], [3], "sit");
  saveCandidates(d, "night", "smug", [PNG], undefined, "back");
  const down = async () => { throw new Error("down"); };
  assert.deepEqual(await pick(d, "day", "wink", 0, down, "sit"), { ok: true, note: "Background removal unavailable — saved the original with its background." });
  await pick(d, "night", "smug", 0, down, "back");
  assert.ok(fs.existsSync(path.join(d, "pose", "sit", "day", "wink.orig.png")));
  assert.deepEqual(Object.keys(listSprites(d).sprites).sort(), ["pose/back/night", "pose/sit/day/wink"]);
  assert.ok("error" in (await pick(d, "day", "wink", 1, down, "sit")));
});
