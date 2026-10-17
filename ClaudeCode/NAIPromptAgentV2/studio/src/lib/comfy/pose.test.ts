import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOpenPose, mirror, moveJoint, LIMBS, type Kp } from "./pose";

const flat = Array.from({ length: 18 }, (_, i) => [100 + i * 10, 50 + i * 20, 0.9]).flat();
const frame = { canvas_width: 200, canvas_height: 400, people: [{ pose_keypoints_2d: flat }] };

test("fromOpenPose normalises and keeps 18 points", () => {
  for (const json of [frame, [frame]]) {
    const k = fromOpenPose(json)!;
    assert.equal(k.length, 18);
    assert.deepEqual(k[0], [0.5, 0.125, 0.9]);
  }
  const f = { ...frame, people: [{ pose_keypoints_2d: [...flat.slice(0, 51), 0, 0, 0] }] };
  assert.deepEqual(fromOpenPose(f)![17], [0, 0, 0]);
  assert.equal(LIMBS.length, 17);
  assert.match(LIMBS[0][2], /^#[0-9a-f]{6}$/);
});

test("fromOpenPose returns null for no people", () => {
  assert.equal(fromOpenPose({ canvas_width: 1, canvas_height: 1, people: [] }), null);
  assert.equal(fromOpenPose([]), null);
  assert.equal(fromOpenPose(null), null);
  assert.equal(fromOpenPose({ ...frame, people: [{ pose_keypoints_2d: [1, 2] }] }), null);
  assert.equal(fromOpenPose({ ...frame, canvas_width: 0 }), null);
});

const k0 = fromOpenPose(frame)!;

test("mirror swaps sides and flips x", () => {
  const m = mirror(k0);
  assert.equal(m[2][0], 1 - k0[5][0]);
  assert.equal(m[2][1], k0[5][1]);
  assert.equal(m[0][0], 1 - k0[0][0]);
  const gap: Kp[] = k0.map((p, i) => (i === 3 ? [0, 0, 0] : p));
  assert.deepEqual(mirror(gap)[6], [0, 0, 0]);
});

test("mirror twice is identity", () => {
  const back = mirror(mirror(k0));
  back.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - k0[i][j]) < 1e-12)));
});

test("moveJoint clamps", () => {
  const before = JSON.stringify(k0);
  const k = moveJoint(k0, 4, 1.5, -0.2);
  assert.deepEqual(k[4], [1, 0, 1]);
  assert.equal(JSON.stringify(k0), before);
});
