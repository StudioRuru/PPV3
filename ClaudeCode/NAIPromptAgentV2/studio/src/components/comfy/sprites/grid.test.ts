import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpriteKey } from "@/lib/sprites/core";
import { type CellView, gridRows } from "./grid";

const key = (k: string, sort: number): SpriteKey => ({ surface: "chat", key: k, label: k, tier: "tame", tags: [], prompt: "", sort });
const keys = Array.from({ length: 13 }, (_, i) => key(`k${i}`, i));
const cell = (from: string, to: string, reverse = false): CellView => ({ id: 1, surface: "chat", outfit: "day", from, to, approvedTake: null, rejected: false, reverse, cut: "none", status: "empty", takes: [] });

test("13x13 in sort order, diagonal is the idle", () => {
  const rows = gridRows([...keys].reverse(), [cell("k2", "k2")], "day");
  assert.equal(rows.length, 13);
  assert.ok(rows.every((r) => r.cols.length === 13));
  assert.deepEqual(rows.map((r) => r.from), keys.map((k) => k.key));
  assert.ok(rows.every((r, i) => r.cols[i].to === r.from));
  assert.equal(rows[2].cols[2].cell?.from, "k2");
});

test("pairs below the diagonal are reverse", () => {
  const rows = gridRows(keys, [cell("k5", "k1", true)], "day");
  assert.equal(rows[5].cols[1].reverse, true);
  assert.equal(rows[5].cols[1].cell?.reverse, true);
  assert.equal(rows[1].cols[5].reverse, false);
});

test("later keys appear and other surfaces/outfits are ignored", () => {
  const rows = gridRows([...keys, key("extra", 99), { ...key("pose", 100), surface: "stage" }], [{ ...cell("k0", "k1"), outfit: "night" }], "day");
  assert.equal(rows.length, 14);
  assert.equal(rows[0].cols[1].cell, null);
});
