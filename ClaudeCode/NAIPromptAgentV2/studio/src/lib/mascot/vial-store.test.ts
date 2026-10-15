import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { VialStore, migrateVials } from "./vial-store";
import type { Vial } from "./vial";

const mk = () => { const db = new Database(":memory:"); migrateVials(db); migrateVials(db); return { db, s: new VialStore(db) }; };
const v = (name = "Brat Brew", effect = "sassier"): Vial => ({ name, color: "#ff0000", effect, sliders: { brat: { value: 2 } } });

test("bottle / list / discard", () => {
  const { s } = mk();
  const a = s.bottle(v()), b = s.bottle(v("Calm", "calmer"));
  assert.deepEqual(s.list().map((r) => [r.id, r.vial.name]), [[a, "Brat Brew"], [b, "Calm"]]);
  s.discard(a);
  assert.deepEqual(s.list().map((r) => r.id), [b]);
  assert.throws(() => s.bottle({ name: "", color: "x", effect: "" } as Vial), /name/);
});

test("bottling records the recipe; same name (any case) bumps it, no duplicates", () => {
  const { s } = mk();
  s.bottle(v());
  s.bottle(v("  brat brew ", "even sassier"));
  const r = s.recipes();
  assert.equal(r.length, 1);
  assert.equal(r[0].brewed, 2);
  assert.equal(r[0].vial.effect, "sassier", "first definition kept");
});

test("brewAgain makes N identical bottles and bumps brewed; count bounds; unknown recipe", () => {
  const { s } = mk();
  s.bottle(v());
  const rid = s.recipes()[0].id;
  const ids = s.brewAgain(rid, 3);
  assert.equal(ids.length, 3);
  assert.equal(s.list().length, 4);
  for (const row of s.list()) assert.deepEqual(row.vial, v());
  assert.equal(s.recipes()[0].brewed, 4);
  assert.equal(s.brewAgain(rid).length, 1);
  for (const n of [0, 6, 1.5]) assert.throws(() => s.brewAgain(rid, n), /count/);
  assert.throws(() => s.brewAgain(999), /Recipe not found/);
  s.forgetRecipe(rid);
  assert.equal(s.recipes().length, 0);
  assert.equal(s.list().length, 5, "forgetting a recipe keeps its bottles");
});

test("take is single-use", () => {
  const { s } = mk();
  const id = s.bottle(v());
  assert.deepEqual(s.take(id), v());
  assert.equal(s.take(id), null);
  assert.equal(s.list().length, 0);
});

test("final review: a same-named bottle never redefines the stored recipe; only brewed bumps", () => {
  const { s } = mk();
  s.bottle(v());
  s.bottle({ ...v("BRAT BREW", "different"), sliders: { brat: { value: -3 } } });
  const r = s.recipes();
  assert.equal(r.length, 1);
  assert.equal(r[0].brewed, 2);
  assert.deepEqual(r[0].vial, v(), "first definition kept");
});
