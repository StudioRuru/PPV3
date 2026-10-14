import { test } from "node:test";
import assert from "node:assert/strict";
import type { Block } from "./blocks";
import { retrieve, systemPrompt, trimHistory } from "./copilot-prompt";
import { emptyState, newLine } from "./prompt";

const b = (id: string, name: string, char: string[]): Block => ({ id, kind: "theme", name, base: [], char, uc: [], user: false });
const blocks = [b("t:1", "Gothic", ["black frills", "choker"]), b("t:2", "Wet & sheer", ["wet clothes", "see-through"]), b("t:3", "Armor break", ["torn clothes"])];

test("retrieve ranks blocks by keyword hits in name and tags", () => {
  assert.deepEqual(retrieve("make her gothic with a choker", blocks).map((x) => x.id), ["t:1"]);
  assert.deepEqual(retrieve("wet see-through dress, torn", blocks).map((x) => x.id), ["t:2", "t:3"]);
  assert.deepEqual(retrieve("hello", blocks), []);
});

test("systemPrompt carries syntax, style, the current prompt and retrieved blocks", () => {
  const s = { ...emptyState(), base: [newLine("night, rain")] };
  const p = systemPrompt({ syntax: "V5 RULES", style: "dark arcs", state: s, blocks: [blocks[0]] });
  for (const part of ["V5 RULES", "dark arcs", "night, rain", "Gothic", "black frills", '"ops"']) assert.ok(p.includes(part), part);
});

test("trimHistory keeps the last N messages starting on a user turn", () => {
  const msgs = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: String(i) }));
  const t = trimHistory(msgs, 20);
  assert.ok(t.length <= 20);
  assert.equal(t[0].role, "user");
  assert.equal(t.at(-1)!.content, "24");
});

test("review: characters are listed by their real index, disabled/empty ones marked", () => {
  const s = { ...emptyState(), chars: [
    { id: "a", lines: [newLine("alice")], uc: "", enabled: false },
    { id: "b", lines: [newLine("bob")], uc: "", enabled: true },
  ] };
  const p = systemPrompt({ syntax: "", style: "", state: s, blocks: [] });
  assert.ok(p.includes("char:0 (disabled): alice"), p);
  assert.ok(p.includes("char:1: bob"));
});
