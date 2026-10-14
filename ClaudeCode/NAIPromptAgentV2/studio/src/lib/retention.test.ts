import { test } from "node:test";
import assert from "node:assert/strict";
import { expiredIds } from "./retention";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 14, 12);
const rows = [{ id: 1, created_at: now - 3.5 * DAY }, { id: 2, created_at: now - 1.5 * DAY }, { id: 3, created_at: now - 0.5 * DAY }, { id: 4, created_at: now }];

test("expiredIds: older than N days go; 'never' (0/null) keeps everything", () => {
  assert.deepEqual(expiredIds(rows, 1, now), [1, 2]);
  assert.deepEqual(expiredIds(rows, 2, now), [1]);
  assert.deepEqual(expiredIds(rows, 3, now), [1]);
  assert.deepEqual(expiredIds(rows, 0, now), []);
  assert.deepEqual(expiredIds(rows, null, now), []);
});

test("review: parseRetention only accepts 1, 2 or 3 — anything else means never", async () => {
  const { parseRetention } = await import("./retention");
  assert.deepEqual(["1", "2", "3", "0", "-1", "0.01", "abc", null].map(parseRetention), [1, 2, 3, null, null, null, null, null]);
});
