import test from "node:test";
import assert from "node:assert/strict";
import { timeline, notebookBlock } from "./recall";
import type { Note } from "./notebook";

const links = [{ id: 1, parent_id: null, parent_at: null }, { id: 2, parent_id: 1, parent_at: 3 }];
const n = (kind: Note["kind"], thread_id: number | null, msg_index: number | null, text = "t"): Note =>
  ({ id: 0, kind, text, thread_id, msg_index, pinned: false, updated_at: 0 });

test("moments on the chain are here, past the branch point are another version", () => {
  assert.equal(timeline(n("moment", 1, 3), 2, links), "here");
  assert.equal(timeline(n("moment", 1, 5), 2, links), "other-version");
  assert.equal(timeline(n("moment", 2, 9), 1, links), "other-version");
  assert.equal(timeline(n("fact", 1, 5), 2, links), "here");
});
test("notes from a deleted thread are plain", () => assert.equal(timeline(n("moment", 99, 0), 2, links), "here"));
test("block puts the relationship first and stays within budget", () => {
  const stance = "S".repeat(300);
  const notes = [n("stance", null, null, stance), ...Array.from({ length: 200 }, (_, i) => n("fact", null, null, "f".repeat(100)))];
  const b = notebookBlock(notes, 1, links);
  assert.ok(b.startsWith("# You and the owner"));
  assert.ok(b.includes(stance));
  assert.ok(b.length <= 6000 + stance.length);
  assert.ok(b.includes("# What you remember"));
});
test("other-version moments get their own section", () => {
  const b = notebookBlock([n("moment", 1, 5, "late")], 2, links);
  assert.ok(b.includes("# From another version") && b.includes("- late"));
  assert.ok(!b.includes("# What you remember"));
});
test("empty notebook gives an empty block", () => assert.equal(notebookBlock([], 1, links), ""));
