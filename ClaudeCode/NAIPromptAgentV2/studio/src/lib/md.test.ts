import { test } from "node:test";
import assert from "node:assert/strict";
import { inline, mdBlocks } from "./md";

test("mdBlocks: headings, bullets, numbered items and paragraphs", () => {
  assert.deepEqual(mdBlocks("## Scene\nRain falls.\nNeon glows.\n\n- **Base:** night\n* rain\n1. first\n2) second"), [
    { kind: "h", text: "Scene" },
    { kind: "p", text: "Rain falls.\nNeon glows." },
    { kind: "li", text: "**Base:** night" },
    { kind: "li", text: "rain" },
    { kind: "ol", text: "1. first" },
    { kind: "ol", text: "2) second" },
  ]);
});

test("inline splits bold and italic runs, leaves stray asterisks alone", () => {
  assert.deepEqual(inline("a **bold** and *soft* 2*3"), [
    { t: "a " }, { t: "bold", b: true }, { t: " and " }, { t: "soft", i: true }, { t: " 2*3" },
  ]);
});
