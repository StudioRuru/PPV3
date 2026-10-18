import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate, addItem, readItem } from "../comfy/store";
import { cell, migrateSprites, addTake, linkTakeItem, approve, takes, edges, listKeys } from "./store";
import { library, safeLibPath, removeKeyData } from "./library";

let db: Database.Database;
const tmp: string[] = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lib-")); tmp.push(d); return d; };
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { db = new Database(":memory:"); migrate(db); migrateSprites(db); });

function done(lib: string, from: string, to: string, surface: "chat" | "stage" = "chat") {
  const c = cell(db, surface, "day", from, to);
  db.prepare("UPDATE sprite_cells SET cut = 'done' WHERE id = ?").run(c.id);
  const d = path.join(lib, surface, "day", `${from}~${to}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ frames: 14, fps: 30, w: 360, h: 640, v: 7 }));
  return c;
}

test("library lists only done cells and maps reverse pairs", () => {
  const lib = mk();
  done(lib, "neutral", "happy");
  cell(db, "chat", "day", "neutral", "sad"); // not cut
  const rev = cell(db, "chat", "day", "happy", "neutral");
  assert.equal(rev.reverse, true);
  const l = library(db, lib);
  const k = (c: { from: string; to: string; reverseOf?: string }) => `${c.from}>${c.to}${c.reverseOf ? `<${c.reverseOf}` : ""}`;
  assert.deepEqual(l.clips.map(k).sort(), ["happy>neutral<neutral~happy", "neutral>happy"]);
  assert.deepEqual(l.clips.find((c) => c.from === "neutral")!, { surface: "chat", outfit: "day", from: "neutral", to: "happy", frames: 14, fps: 30, w: 360, h: 640, v: 7 });
  assert.deepEqual(l.outfits, ["day", "night", "lewd"]);
  assert.equal(l.keys.length, 27);
});
test("safeLibPath rejects .. and absolute parts", () => {
  assert.equal(safeLibPath("/L", ["..", "x"]), null);
  assert.equal(safeLibPath("/L", ["/etc", "passwd"]), null);
  assert.equal(safeLibPath("/L", ["../../studio.db"]), null);
  assert.equal(safeLibPath("/L", ["chat", "day", "happy~sad", "000.webp"]), "/L/chat/day/happy~sad/000.webp");
});
test("removeKeyData deletes cells, takes, edges, lib dirs and generated items but keeps adopted ones", () => {
  const lib = mk(), dir = mk();
  const item = (f: string) => { fs.writeFileSync(path.join(dir, f), "x"); return addItem(db, { kind: "clip", file: f, poster: null, recipe: {}, seed: 1, cost: 0, createdAt: 0 }); };
  const [gen, adopted, other] = [item("g.mp4"), item("a.png"), item("o.mp4")];
  const e = cell(db, "stage", "day", "sit", "");
  const ta = addTake(db, e.id, null, 0, {}); linkTakeItem(db, ta, adopted); approve(db, e.id, ta);
  const c = cell(db, "stage", "day", "stand", "sit");
  const tg = addTake(db, c.id, 9, 1, {}); linkTakeItem(db, tg, gen);
  const keep = cell(db, "stage", "day", "stand", "kneel");
  const tk = addTake(db, keep.id, 9, 1, {}); linkTakeItem(db, tk, other);
  done(lib, "stand", "sit", "stage"); done(lib, "stand", "kneel", "stage");
  assert.ok(edges(db).some(([a, b]) => a === "sit" && b === "stand"));
  removeKeyData(db, "stage", "sit", { dir, lib });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sprite_cells WHERE to_key = 'sit' OR from_key = 'sit'").get() as { n: number }).n, 0);
  assert.equal(takes(db, c.id).length, 0);
  assert.equal(takes(db, keep.id).length, 1);
  assert.ok(!edges(db).some(([a, b]) => a === "sit" || b === "sit"));
  assert.ok(!listKeys(db, "stage").some((k) => k.key === "sit"));
  assert.equal(readItem(db, gen), null);
  assert.ok(!fs.existsSync(path.join(dir, "g.mp4")));
  assert.ok(readItem(db, adopted));
  assert.ok(readItem(db, other));
  assert.ok(!fs.existsSync(path.join(lib, "stage", "day", "stand~sit")));
  assert.ok(fs.existsSync(path.join(lib, "stage", "day", "stand~kneel")));
});
test("a traversal outfit never reaches the filesystem", () => {
  const lib = mk(), victim = mk();
  fs.mkdirSync(path.join(victim, "a~b"));
  const c = cell(db, "stage", path.relative(path.join(lib, "stage"), victim), "a", "b");
  removeKeyData(db, "stage", "a", { dir: mk(), lib });
  assert.ok(fs.existsSync(path.join(victim, "a~b")));
  assert.equal(db.prepare("SELECT 1 FROM sprite_cells WHERE id = ?").get(c.id), undefined);
});
