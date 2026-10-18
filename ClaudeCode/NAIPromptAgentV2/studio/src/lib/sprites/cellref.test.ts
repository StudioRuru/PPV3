import assert from "node:assert/strict";
import { test } from "node:test";
import { cellRef } from "./cellref";

const keys = [{ surface: "chat" as const, key: "a" }, { surface: "chat" as const, key: "b" }, { surface: "stage" as const, key: "s" }];
test("cellRef accepts endpoints and clips, rejects the rest", () => {
  assert.deepEqual(cellRef({ surface: "chat", outfit: "day", from: "a" }, ["day"], keys), { surface: "chat", outfit: "day", from: "a", to: "" });
  assert.deepEqual(cellRef({ surface: "chat", outfit: "day", from: "a", to: "b" }, ["day"], keys), { surface: "chat", outfit: "day", from: "a", to: "b" });
  for (const b of [null, { surface: "x", outfit: "day", from: "a" }, { surface: "chat", outfit: "zz", from: "a" }, { surface: "chat", outfit: "day", from: "s" }, { surface: "chat", outfit: "day", from: "@base" }, { surface: "chat", outfit: "day", from: "a", to: "s" }])
    assert.equal(typeof cellRef(b, ["day"], keys), "string");
});
