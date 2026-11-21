import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrate } from "./store";
import { preflight, saveVolumeList, deadMessage } from "./preflight";

const memDb = () => { const db = new Database(":memory:"); migrate(db); return db; };
const e = (filename: string, size: number, urls = ["https://a/x"], cards: ("main" | "boost")[] = ["main"]) => ({ kind: "diffusion_models", filename, sha256: "", size, urls, licence: "", cards });

test("only entries missing from the saved volume list are checked", async () => {
  const db = memDb(); saveVolumeList(db, "main", [{ name: "diffusion_models/a.safetensors", size: 10 }]);
  const seen: string[] = [];
  const dead = await preflight("main", { db, manifest: [e("a.safetensors", 10, ["https://a"]), e("b.safetensors", 5, ["https://b"])], head: async (u) => (seen.push(u), 200), now: 1 });
  assert.deepEqual([dead, seen], [[], ["https://b"]]);
});

test("dead only when every mirror fails", async () => {
  const db = memDb();
  const st: Record<string, number> = { "https://m1": 404, "https://m2": 200, "https://m3": 500 };
  const head = async (u: string) => st[u];
  assert.deepEqual(await preflight("main", { db, manifest: [e("a.safetensors", 1, ["https://m1", "https://m2"])], head, now: 1 }), []);
  const dead = await preflight("main", { db: memDb(), manifest: [e("a.safetensors", 1, ["https://m1", "https://m3"])], head, now: 1 });
  assert.deepEqual(dead, [{ label: "a checkpoint", filename: "a.safetensors", url: "https://m1", status: 404 }]);
  assert.match(deadMessage(dead), /a checkpoint link is dead — fix the manifest \(a\.safetensors, 404\)/);
});

test("good result cached 24 h", async () => {
  const db = memDb(); let n = 0;
  const deps = { db, manifest: [e("a.safetensors", 1)], head: async () => (n++, 200) };
  await preflight("main", { ...deps, now: 0 });
  await preflight("main", { ...deps, now: 3600_000 });
  assert.equal(n, 1);
  await preflight("main", { ...deps, now: 25 * 3600_000 });
  assert.equal(n, 2);
});

test("saveVolumeList clears the good-link cache", async () => {
  const db = memDb(); let n = 0;
  const deps = { db, manifest: [e("a.safetensors", 1)], head: async () => (n++, 200), now: 1 };
  await preflight("main", deps);
  saveVolumeList(db, "main", []);
  await preflight("main", deps);
  assert.equal(n, 2);
});

test("size mismatch counts as missing", async () => {
  const db = memDb(); saveVolumeList(db, "main", [{ name: "diffusion_models/a.safetensors", size: 9 }]);
  const seen: string[] = [];
  await preflight("main", { db, manifest: [e("a.safetensors", 10)], head: async (u) => (seen.push(u), 200), now: 1 });
  assert.equal(seen.length, 1);
});

test("no saved list checks every entry", async () => {
  const db = memDb(); const seen: string[] = [];
  await preflight("boost", { db, manifest: [e("a", 1, ["https://a"], ["boost"]), e("b", 1, ["https://b"], ["boost"]), e("c", 1, ["https://c"])], head: async (u) => (seen.push(u), 200), now: 1 });
  assert.deepEqual(seen, ["https://a", "https://b"]);
});
