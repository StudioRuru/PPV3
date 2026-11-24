import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneHistory, type SceneTurn } from "./scene";

test("sceneHistory keeps the last 12 turns and re-attaches the cleaned JSON to assistant turns", () => {
  const out = { target: "photo" as const, prompt: "a rooftop", loras: [] };
  const turns: SceneTurn[] = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
  turns[13] = { role: "assistant", content: "Here you go.", out };
  const h = sceneHistory(turns);
  assert.equal(h.length, 12);
  assert.equal(h[0].content, "t2");
  assert.equal(h[11].content, `Here you go.\n\n\`\`\`json\n${JSON.stringify(out)}\n\`\`\``);
  assert.equal(h[10].content, "t12");
});
