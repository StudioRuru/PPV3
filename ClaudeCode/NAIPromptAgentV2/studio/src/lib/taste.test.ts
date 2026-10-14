import { test } from "node:test";
import assert from "node:assert/strict";
import { profile, tasteBlock } from "./taste";

const ev = (kind: "apply" | "like" | "dislike", tags: string[], note = "") => ({ kind, tags, note, created_at: 0 });

test("profile: applied/liked tags are favoured, disliked are avoided, weighted by count; notes kept newest-first", () => {
  const p = profile([
    ev("apply", ["torn clothes", "sweat"]), ev("like", ["torn clothes", "1.2::torn clothes::"]), ev("dislike", ["blood"], "too gory"),
    ev("like", [], "loved the slow escalation"),
  ]);
  assert.deepEqual(p.favoured.slice(0, 2), ["torn clothes", "sweat"]);
  assert.deepEqual(p.avoided, ["blood"]);
  assert.deepEqual(p.notes, ["loved the slow escalation", "too gory"]);
});

test("tasteBlock: empty → nothing; capped lists; pinned rules first", () => {
  assert.equal(tasteBlock({ favoured: [], avoided: [], notes: [] }, []), "");
  const many = Array.from({ length: 100 }, (_, i) => `tag${i}`);
  const b = tasteBlock({ favoured: many, avoided: many, notes: many }, ["always 2 characters"]);
  assert.match(b, /always 2 characters/);
  assert.ok((b.match(/tag/g) ?? []).length <= 20 + 10 + 5 * 1 + 5, "caps keep it small");
  assert.ok(b.length < 2000);
});
