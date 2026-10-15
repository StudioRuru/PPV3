import { test } from "node:test";
import assert from "node:assert/strict";
import { profile, storyBlock, tasteBlock } from "./taste";

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

const rp = (kind: "like" | "dislike", note: string) => ({ kind, tags: ["ignored-tag"], note, created_at: 0, source: "rp" as const });

test("RP events never change the tag profile", () => {
  const p = profile([ev("like", ["sweat"]), rp("like", "great slow burn"), rp("dislike", "too fast")]);
  assert.deepEqual(p.favoured, ["sweat"]);
  assert.deepEqual(p.avoided, []);
  assert.deepEqual(p.notes, []);
});

test("storyBlock: RP notes only, likes and dislikes, newest first; empty → ''", () => {
  assert.equal(storyBlock([ev("like", ["x"], "tag note")]), "");
  const b = storyBlock([rp("like", "old like"), ev("like", [], "tag note"), rp("dislike", "breaks character"), rp("like", "new like")]);
  assert.doesNotMatch(b, /tag note/);
  assert.match(b, /new like[\s\S]*old like/);
  assert.match(b, /Avoid[\s\S]*breaks character/);
});

test("storyBlock stays capped with 100 long notes", () => {
  const many = Array.from({ length: 100 }, (_, i) => rp(i % 2 ? "like" : "dislike", `${i} ${"z".repeat(500)}`));
  const b = storyBlock(many);
  assert.ok(b.length <= 1500, `got ${b.length}`);
  assert.ok((b.match(/z{200}/g) ?? []).length <= 13);
});
