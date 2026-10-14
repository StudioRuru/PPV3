import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Conflict, createItem, listCloset, readItem, saveItem, trashItem } from "./closet-store";
import { fieldKey } from "./closet";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "closet-"));

test("create, list, save (with .bak), conflict on outside change, duplicate never overwrites, trash moves", () => {
  const root = tmp();
  const a = createItem("outfit", "Lace Set", {}, root);
  assert.equal(a.slug, "lace-set");
  assert.deepEqual(listCloset(root).map((i) => [i.kind, i.slug]), [["outfit", "lace-set"]]);

  const fields = a.fields.map((f) => (fieldKey(f.path) === "tags.tops" ? { ...f, value: ["lace bra"] } : f));
  const saved = saveItem("outfits", "lace-set", fields, a.mtime, undefined, root);
  assert.deepEqual(saved.fields.find((f) => fieldKey(f.path) === "tags.tops")!.value, ["lace bra"]);
  assert.ok(fs.existsSync(path.join(root, "outfits", "lace-set.yaml.bak")));

  fs.utimesSync(path.join(root, "outfits", "lace-set.yaml"), new Date(), new Date(Date.now() + 5000));
  assert.throws(() => saveItem("outfits", "lace-set", fields, saved.mtime, undefined, root), Conflict);

  const dup = createItem("outfit", "Lace Set", { from: { dir: "outfits", slug: "lace-set" } }, root);
  assert.equal(dup.slug, "lace-set-2");
  assert.deepEqual(dup.fields.find((f) => fieldKey(f.path) === "tags.tops")!.value, ["lace bra"]);

  trashItem("outfits", "lace-set-2", root);
  assert.equal(readItem("outfits", "lace-set-2", root), null);
  assert.equal(fs.readdirSync(path.join(root, ".trash", "outfits")).length, 1);
});

test("arc scenes can be added and removed through save", () => {
  const root = tmp();
  const arc = createItem("arc", "Night Arc", {}, root);
  const two = saveItem("arcs", "night-arc", arc.fields, arc.mtime, { scene: "add" }, root);
  assert.ok(two.fields.some((f) => fieldKey(f.path) === "scenes.1.title"));
  const one = saveItem("arcs", "night-arc", two.fields, two.mtime, { scene: "remove", index: 0 }, root);
  assert.ok(!one.fields.some((f) => fieldKey(f.path) === "scenes.1.title"));
});

test("unsafe references are refused", () => {
  const root = tmp();
  assert.equal(readItem("../etc", "x", root), null);
  assert.equal(readItem("outfits", "../../x", root), null);
  assert.throws(() => trashItem("gallery", "x", root));
});
