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

test("review I1/I6: duplicating a 64-char name twice terminates; a theme copy gets its own slug field", () => {
  const root = tmp();
  const long = "x".repeat(70);
  const a = createItem("cluster", long, {}, root);
  const b = createItem("cluster", long, {}, root);
  const c = createItem("cluster", long, { from: { dir: "clusters", slug: a.slug } }, root);
  assert.equal(new Set([a.slug, b.slug, c.slug]).size, 3);
  fs.mkdirSync(path.join(root, "themes"), { recursive: true });
  fs.writeFileSync(path.join(root, "themes", "armor-break.yaml"), 'name: "Armor Break"\nslug: armor-break\ndescription: d\n');
  const t = createItem("theme", "Armor Break copy", { from: { dir: "themes", slug: "armor-break" } }, root);
  assert.match(fs.readFileSync(path.join(root, "themes", `${t.slug}.yaml`), "utf8"), new RegExp(`slug: ${t.slug}`));
});

test("review I4: the server only takes known fields from disk, typed — a forged field can't wipe scenes", () => {
  const root = tmp();
  const arc = createItem("arc", "A", {}, root);
  const forged = [...arc.fields, { path: ["scenes"], label: "x", type: "text" as const, value: "wiped" }, { path: ["name"], label: "Name", type: "text" as const, value: 42 as unknown as string }];
  const saved = saveItem("arcs", arc.slug, forged, arc.mtime, undefined, root);
  assert.ok(saved.fields.some((f) => fieldKey(f.path) === "scenes.0.title"), "scenes intact");
  assert.equal(saved.fields.find((f) => fieldKey(f.path) === "name")!.value, "A");
});
