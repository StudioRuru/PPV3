import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRows, zipName } from "./export";

const day = new Date(2026, 9, 14, 15, 0).getTime();
const rows = [
  { id: 5, created_at: day - 1_000 }, { id: 4, created_at: day - 3_600_000 }, { id: 3, created_at: new Date(2026, 9, 13, 23, 0).getTime() },
  { id: 2, created_at: new Date(2026, 9, 12).getTime() }, { id: 1, created_at: new Date(2026, 9, 1).getTime() },
];

test("pickRows: today since local midnight, last N, or chosen ids — newest first, capped", () => {
  assert.deepEqual(pickRows(rows, { today: true }, day).map((r) => r.id), [5, 4]);
  assert.deepEqual(pickRows(rows, { last: 3 }, day).map((r) => r.id), [5, 4, 3]);
  assert.deepEqual(pickRows(rows, { ids: [1, 3, 99] }, day).map((r) => r.id), [3, 1]);
  assert.deepEqual(pickRows(rows, { last: 0 }, day), []);
  // Streamed zips: no silent cap below what the roll can show (a short zip before "Clear all" loses images).
  assert.equal(pickRows(Array.from({ length: 1500 }, (_, i) => ({ id: i, created_at: day })), { last: 1500 }, day).length, 1500);
});

test("zipName names the export by its newest image date", () => {
  assert.equal(zipName(pickRows(rows, { last: 2 }, day)), "nai-studio-2026-10-14-2-images.zip");
});
