import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "yaml";
import { addScene, diffFields, fieldKey, parseEnhance, patchText, removeScene, safeRef, toFields } from "./closet";

const OUTFIT = `name: "Black Peplum"
# hand-written comment that must survive
description: "Sheer top"
genre: "fetish"
tags:
  tops: ["see-through", "frilled shirt"]
  bottoms: ["bottomless"]
weight_overrides:
  emphasized: ["bottomless"]
notes: >
  Folded notes stay as they are.
`;

const ARC = `name: "Cut"
description: >
  An arc.
artist: "artist:ciloranko"
scenes:
  - scene_number: 1
    title: "Pole"
    narrative: "Poses."
    prompt:
      base: "1girl, race track"
      character: "girl, white mini dress"
      undesired: "lowres"
`;

test("toFields: an outfit exposes name, description, each tag slot and emphasized", () => {
  const f = toFields("outfit", parseDocument(OUTFIT));
  assert.deepEqual(f.map((x) => [fieldKey(x.path), x.type]), [
    ["name", "text"], ["description", "long"], ["tags.tops", "tags"], ["tags.bottoms", "tags"], ["weight_overrides.emphasized", "tags"],
  ]);
  assert.deepEqual(f[2].value, ["see-through", "frilled shirt"]);
});

test("patchText: unchanged → byte-identical; a change touches only that field, comments and other text intact", () => {
  const f0 = toFields("outfit", parseDocument(OUTFIT));
  assert.equal(patchText(OUTFIT, f0), OUTFIT);
  const f = f0.map((x) => (fieldKey(x.path) === "tags.tops" ? { ...x, value: ["see-through", "black bra"] } : fieldKey(x.path) === "notes" ? x : x));
  const out = patchText(OUTFIT, f);
  assert.equal(out, OUTFIT.replace('tops: ["see-through", "frilled shirt"]', 'tops: ["see-through", "black bra"]'));
  const folded = patchText(OUTFIT, f0.map((x) => (fieldKey(x.path) === "description" ? { ...x, value: 'Sheer "lace" top' } : x)));
  assert.equal(folded, OUTFIT.replace('description: "Sheer top"', 'description: "Sheer \\"lace\\" top"'));
  assert.equal(parseDocument(folded).get("description"), 'Sheer "lace" top');
});

test("patchText: a folded (>) block that changes becomes a quoted line; the rest of the file is untouched", () => {
  const out = patchText(ARC, toFields("arc", parseDocument(ARC)).map((x) => (fieldKey(x.path) === "description" ? { ...x, value: "A darker arc." } : x)));
  assert.equal(out, ARC.replace("description: >\n  An arc.\n", 'description: "A darker arc."\n'));
  assert.equal(parseDocument(out).get("artist"), "artist:ciloranko");
});

test("arcs: scene fields, add and remove scenes", () => {
  const doc = parseDocument(ARC);
  const f = toFields("arc", doc);
  assert.ok(f.some((x) => fieldKey(x.path) === "scenes.0.prompt.character" && x.value === "girl, white mini dress"));
  addScene(doc);
  const after = toFields("arc", doc);
  assert.ok(after.some((x) => fieldKey(x.path) === "scenes.1.title"));
  assert.equal(doc.getIn(["scenes", 1, "scene_number"]), 2);
  removeScene(doc, 0);
  assert.equal(doc.getIn(["scenes", 0, "title"]), "New scene");
  assert.equal(doc.getIn(["scenes", 0, "scene_number"]), 1, "renumbered 1..n");
});

test("diffFields: added/removed tags and changed text", () => {
  const a = toFields("outfit", parseDocument(OUTFIT));
  const b = a.map((x) => (fieldKey(x.path) === "tags.tops" ? { ...x, value: ["see-through", "black bra"] } : fieldKey(x.path) === "name" ? { ...x, value: "Black Peplum II" } : x));
  assert.deepEqual(diffFields(a, b), [
    { key: "name", label: "Name", from: "Black Peplum", to: "Black Peplum II" },
    { key: "tags.tops", label: "Tops", added: ["black bra"], removed: ["frilled shirt"] },
  ]);
});

test("parseEnhance: takes known keys of the right type from the last json block, rejects junk", () => {
  const fields = toFields("outfit", parseDocument(OUTFIT));
  const r = parseEnhance('Here.\n```json\n{"fields":{"tags.tops":["see-through","lace bra"],"name":"Lace","bogus":"x","tags.bottoms":"not a list"}}\n```', fields);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.fields!.find((x) => fieldKey(x.path) === "tags.tops")!.value, ["see-through", "lace bra"]);
  assert.equal(r.fields!.find((x) => fieldKey(x.path) === "name")!.value, "Lace");
  assert.deepEqual(r.fields!.find((x) => fieldKey(x.path) === "tags.bottoms")!.value, ["bottomless"], "wrong type ignored");
  assert.match(parseEnhance("no json here", fields).error ?? "", /couldn't read/i);
});

test("safeRef: only known kinds and plain slugs", () => {
  assert.deepEqual(safeRef("outfits", "black-peplum"), { kind: "outfit", dir: "outfits", slug: "black-peplum" });
  assert.equal(safeRef("outfits", "../studio"), null);
  assert.equal(safeRef("gallery", "x"), null);
  assert.equal(safeRef("arcs", "a/b"), null);
});
