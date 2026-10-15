import { test } from "node:test";
import assert from "node:assert/strict";
import { isHex, mixError, PALETTE, ratioLabel, shelfRows } from "./shelf";

const jar = (id: number, active = false) => ({ id, name: `J${id}`, color: "#ffffff", origin: "miyabi", selfName: "M", active });

test("PALETTE: ~10 distinct #rrggbb swatches", () => {
  assert.ok(PALETTE.length >= 8 && PALETTE.length <= 12);
  assert.equal(new Set(PALETTE).size, PALETTE.length);
  for (const c of PALETTE) assert.ok(isHex(c), c);
});

test("isHex: #rrggbb only", () => {
  assert.equal(isHex("#a1B2c3"), true);
  for (const c of ["#abc", "a1b2c3", "#a1b2c3d", "#zzzzzz", ""]) assert.equal(isHex(c), false, c);
});

test("shelfRows: empty slot first when Empty, jars in id order, rows of 3", () => {
  const rows = shelfRows([jar(5), jar(2), jar(9), jar(1)], true);
  assert.deepEqual(rows.map((r) => r.map((s) => (s.kind === "empty" ? "E" : s.jar.id))), [["E", 1, 2], [5, 9]]);
  assert.deepEqual(shelfRows([jar(1, true), jar(2)], false).map((r) => r.map((s) => s.kind)), [["jar", "jar"]]);
  assert.deepEqual(shelfRows([], false), []);
  assert.deepEqual(shelfRows([], true), [[{ kind: "empty" }]]);
  assert.equal(shelfRows([jar(1), jar(2), jar(3), jar(4)], false, 2).length, 2);
});

test("ratioLabel: A share / B share", () => {
  assert.equal(ratioLabel(70), "70% A / 30% B");
  assert.equal(ratioLabel(10, "Miyabi", "Blank"), "10% Miyabi / 90% Blank");
});

test("mixError: needs A, a different B or blank, ratio 10–90, name ≤40, hex colour", () => {
  const ok = { a: 1, b: 2 as number | "blank" | null, ratio: 50, name: "Brew", color: "#ff00aa" };
  assert.equal(mixError(ok), null);
  assert.equal(mixError({ ...ok, b: "blank" }), null);
  assert.match(mixError({ ...ok, a: null })!, /first jar/i);
  assert.match(mixError({ ...ok, b: null })!, /second/i);
  assert.match(mixError({ ...ok, b: 1 })!, /different/i);
  assert.match(mixError({ ...ok, ratio: 5 })!, /10–90/);
  assert.match(mixError({ ...ok, ratio: 91 })!, /10–90/);
  assert.match(mixError({ ...ok, ratio: 33.5 })!, /10–90/);
  assert.match(mixError({ ...ok, name: "  " })!, /name/i);
  assert.match(mixError({ ...ok, name: "x".repeat(41) })!, /name/i);
  assert.match(mixError({ ...ok, color: "red" })!, /colour/i);
});
