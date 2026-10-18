import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateSprites, listKeys, listOutfits, upsertKey, removeKey, allowedKeys, cell, cellStatus, addTake, takes, linkTakeItem, approve, reject, edges, setEdge } from "./store";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); migrateSprites(db); });

test("seeds 13 chat expressions, 14 stage poses, 3 outfits", () => {
  assert.equal(listKeys(db, "chat").length, 13);
  assert.deepEqual(listKeys(db, "chat").filter((k) => k.tier === "lewd").map((k) => k.key).sort(), ["horny", "humiliated", "yandere"]);
  assert.equal(listKeys(db, "stage").length, 14);
  assert.deepEqual(listOutfits(db).map((o) => o.key), ["day", "night", "lewd"]);
  migrateSprites(db); assert.equal(listKeys(db, "chat").length, 13);
  assert.equal(edges(db).length, 20);
});
test("allowedKeys gates by boldness and lewd outfit", () => {
  const chat = listKeys(db, "chat");
  assert.equal(allowedKeys(chat, "tame", "day").length, 8);
  assert.equal(allowedKeys(chat, "teasing", "day").length, 10);
  assert.equal(allowedKeys(chat, "lewd", "day").length, 13);
  upsertKey(db, { surface: "stage", key: "spread", label: "Spread", tier: "lewd", tags: ["lewd"], prompt: "x", sort: 99 });
  const st = listKeys(db, "stage");
  assert.ok(!allowedKeys(st, "lewd", "day").some((k) => k.key === "spread"));
  assert.ok(allowedKeys(st, "lewd", "lewd").some((k) => k.key === "spread"));
  removeKey(db, "stage", "spread");
  assert.ok(!listKeys(db, "stage").some((k) => k.key === "spread"));
});
test("cellStatus derives from takes and job rows", () => {
  const c = cell(db, "chat", "day", "happy", "sad");
  const js = new Map<number, string>();
  const st = () => cellStatus(cell(db, "chat", "day", "happy", "sad"), takes(db, c.id), (id) => (js.get(id) as never) ?? null);
  assert.equal(st(), "empty");
  addTake(db, c.id, 1, 11, {}); js.set(1, "queued"); assert.equal(st(), "queued");
  js.set(1, "running"); assert.equal(st(), "generating");
  js.set(1, "error"); assert.equal(st(), "empty");
  const t = addTake(db, c.id, 2, 12, {}); js.set(2, "done"); linkTakeItem(db, t, 50); assert.equal(st(), "review");
  reject(db, c.id); assert.equal(st(), "rejected");
  approve(db, c.id, t); assert.equal(st(), "approved");
});
test("approve returns the other takes' items and keeps their seed rows", () => {
  const c = cell(db, "chat", "day", "neutral", "neutral");
  const a = addTake(db, c.id, 3, 1, { a: 1 }); linkTakeItem(db, a, 7);
  const b = addTake(db, c.id, 4, 2, { b: 1 }); linkTakeItem(db, b, 8);
  assert.deepEqual(approve(db, c.id, a).dropItems, [8]);
  assert.deepEqual(takes(db, c.id).map((t) => [t.seed, t.itemId]), [[1, 7], [2, null]]);
});
test("re-approving an endpoint resets clips that touch it", () => {
  const e = cell(db, "chat", "day", "happy", "");
  const clip = cell(db, "chat", "day", "happy", "sad");
  const t = addTake(db, clip.id, 9, 1, {}); linkTakeItem(db, t, 90); approve(db, clip.id, t);
  const et = addTake(db, e.id, 10, 1, {}); linkTakeItem(db, et, 91);
  approve(db, e.id, et);
  assert.equal(cell(db, "chat", "day", "happy", "sad").approvedTake, null);
  assert.equal(cell(db, "chat", "day", "happy", "sad").cut, "none");
  assert.equal(cell(db, "chat", "day", "happy", "").approvedTake, et);
});
test("edges are undirected and deduped", () => {
  setEdge(db, "sit", "stand", true); setEdge(db, "stand", "sit", true);
  assert.deepEqual(edges(db).filter(([a, b]) => a === "sit" && b === "stand"), [["sit", "stand"]]);
  const n = edges(db).length;
  setEdge(db, "stand", "sit", false); assert.equal(edges(db).length, n - 1);
});
test("new chat transition cells get reverse when from sorts after to", () => {
  const chat = listKeys(db, "chat");
  const [lo, hi] = [chat[0].key, chat[3].key];
  assert.equal(cell(db, "chat", "day", hi, lo).reverse, true);
  assert.equal(cell(db, "chat", "day", lo, hi).reverse, false);
  assert.equal(cell(db, "chat", "day", lo, lo).reverse, false);
  assert.equal(cell(db, "chat", "day", hi, "").reverse, false);
  assert.equal(cell(db, "chat", "day", "@base", "").reverse, false);
  assert.equal(cell(db, "stage", "day", "stand", "sit").reverse, false);
});
