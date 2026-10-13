import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBlocks, listPresets, saveCluster, savePreset } from "./library";

function tmpData() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lib-"));
  fs.mkdirSync(path.join(d, "outfits"));
  fs.writeFileSync(path.join(d, "outfits", "a.yaml"), "name: A\ntags:\n  tops: [shirt]\n");
  fs.writeFileSync(path.join(d, "outfits", "broken.yaml"), "name: [unclosed\n");
  return d;
}

test("lists outfits, skips broken YAML, includes saved clusters", () => {
  const d = tmpData();
  saveCluster({ name: "Maid Set", kind: "theme", tags: ["maid", " ", "maid headdress"] }, d);
  const ids = listBlocks(d).map((b) => b.id).sort();
  assert.deepEqual(ids, ["cluster:maid-set", "outfit:a"]);
  assert.deepEqual(listBlocks(d).find((b) => b.id === "cluster:maid-set")!.char, ["maid", "maid headdress"]);
});

test("hostile names stay inside data/clusters; bad input rejected", () => {
  const d = tmpData();
  saveCluster({ name: "../../escape", kind: "cluster", tags: ["x"] }, d);
  assert.ok(fs.existsSync(path.join(d, "clusters", "escape.yaml")));
  assert.ok(!fs.existsSync(path.join(d, "..", "escape.yaml")));
  assert.throws(() => saveCluster({ name: "💀", kind: "cluster", tags: ["x"] }, d), /name/i);
  assert.throws(() => saveCluster({ name: "ok", kind: "cluster", tags: [] }, d), /tag/i);
});

test("presets = builtins + saved", () => {
  const d = tmpData();
  savePreset({ name: "Faces", enabled: { character: true, general: true }, groups: [0, 1] }, d);
  const ids = listPresets(d).map((p) => p.id);
  assert.deepEqual(ids, ["full", "outfit", "char-artist", "faces"]);
});
