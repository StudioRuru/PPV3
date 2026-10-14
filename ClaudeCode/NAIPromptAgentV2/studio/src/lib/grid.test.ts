import { test } from "node:test";
import assert from "node:assert/strict";
import { gridLines, gridWeights, isFree, setLineWeight } from "./grid";
import { DEFAULT_PARAMS } from "./nai-body";
import { emptyState, newLine, type PromptState } from "./prompt";

test("gridWeights spaces min..max evenly, clamps steps to 3-6 and fixes a reversed range", () => {
  assert.deepEqual(gridWeights(0.6, 1.4, 5), [0.6, 0.8, 1, 1.2, 1.4]);
  assert.deepEqual(gridWeights(0.5, 1.5, 10).length, 6);
  assert.deepEqual(gridWeights(1.5, 0.5, 1), [0.5, 1, 1.5]);
  assert.deepEqual(gridWeights(0.7, 1.3, 4), [0.7, 0.9, 1.1, 1.3]);
});

function state(): PromptState {
  const s = emptyState();
  s.base = [newLine("1girl"), newLine(""), newLine("smile", 1.2)];
  s.chars = [{ id: "c1", lines: [newLine("red hair")], uc: "", enabled: true }];
  return s;
}

test("gridLines lists every non-empty line with where it lives", () => {
  const s = state();
  assert.deepEqual(gridLines(s).map((l) => [l.where, l.text]), [["Base", "1girl"], ["Base", "smile"], ["Character 1", "red hair"]]);
});

test("setLineWeight finds the line in base or a character; weight 1 clears it", () => {
  const s = state();
  const hair = s.chars[0].lines[0].id;
  assert.equal(setLineWeight(s, hair, 1.3).chars[0].lines[0].weight, 1.3);
  assert.equal(setLineWeight(s, s.base[2].id, 1).base[2].weight, undefined);
  assert.equal(setLineWeight(s, "missing", 2), s);
});

test("isFree: one image at ≤1 Mpx and ≤28 steps costs no Anlas on Opus", () => {
  assert.equal(isFree(DEFAULT_PARAMS), true);
  assert.equal(isFree({ ...DEFAULT_PARAMS, steps: 29 }), false);
  assert.equal(isFree({ ...DEFAULT_PARAMS, width: 1216, height: 1216 }), false);
});
