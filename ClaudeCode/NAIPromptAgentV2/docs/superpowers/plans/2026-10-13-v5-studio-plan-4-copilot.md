# V5 Studio Plan 4: Chat Co-pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat sheet in the Studio. Turning it on loads a local uncensored brain model. The brain builds characters, scenes, themes, arc steps and clusters as patch cards you Apply or Discard. "Read this image" captions the tagged image with ToriiGate, and the drawer's "Suggested" section is filled by TIPO.

**Architecture:**
- Three local backends, all reached only from server routes:
  - Ollama :11434 for the brain (Gemma4-12B, `/api/chat`, streamed).
  - `llama-server` :8191 for ToriiGate (OpenAI-compatible `/v1/chat/completions` with an image).
  - `llama-server` :8193 for TIPO (raw `/completion`).
- Pure, tested libraries do all the parsing and state edits: `patch.ts` (ops contract → `PromptState`), `tipo.ts` (TIPO prompt/output) and `copilot-prompt.ts` (system prompt + keyword retrieval).
- Routes stay thin. Chat history lives in SQLite so the phone and the Mac share it.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, better-sqlite3, sharp, node:test via tsx. brew `llama.cpp`, Ollama 0.35.

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` (§3, §4.6, §5, §6)

## Global Constraints

- No Claude or remote API inside the app; every model runs locally (spec §1).
- Brain: `hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M`. Samplers: temp 0.6, top_k 64, top_p 0.9, min_p 0.05, repeat_penalty 1.1.
- Toggle on → load the brain with keep-alive; toggle off → `keep_alive: 0`. Default off.
- Output contract: prose plus one fenced JSON block `{"ops":[{"target":"base|char:N|uc","action":"add|remove|replace|weight","line":"…","weight":1.15}]}`. It renders as a patch card with Apply and Discard. Unknown tags are flagged against the CSV and YAML.
- Context: `v5-syntax.md`, the current prompt state, keyword-retrieved library blocks (not the whole DB), and scene-style preferences.
- Quick modes: Create character, Build scene, Theme, Arc step, Cluster these tags.
- Backend offline → banner; the rest of the app keeps working (spec §5).
- ToriiGate: prompts verbatim from its `scripts/prompts.py`, ~1 Mpx input, single image, single turn.
- Phone-first: 44 px touch targets, 16 px inputs (no iOS zoom), Night Studio tokens already in `globals.css`.
- Git: commit with `-c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`, named files only, never push.

## Review Focus

1. **Bad brain output:** malformed or partial JSON, unknown actions, `char:7` with two characters, non-numeric weight. The card shows "couldn't read changes" or skips the bad op and never crashes; a `char:N` past the end creates the character, like `applyTags`. *Tests: Task 2.*
2. **A backend dies mid-stream** (Ollama killed or toggled off during a reply). The stream ends, the partial text stays with an error line, and nothing half-written is saved to history. *Route behaviour; checked live in Task 4 step 6.*
3. **A 12 MP phone photo to "Read this image".** The server resizes it to ≤1 Mpx JPEG before ToriiGate; a non-image returns 422, not 500. *Task 4 `toModelImage` test.*
4. **Long conversations past the context window.** Only the last 20 messages go to the brain, with `num_ctx` 16384. *Task 3 test.*
5. **TIPO echoing the input or emitting junk lines.** The suggestions shown are only new tags: not in the input, de-duplicated, and capped at 12. *Task 3 test.*

---

### Task 1: Model runtimes, scripts and env

**Files:**
- Modify: `studio/package.json` (scripts)
- Modify: `studio/src/lib/env.ts`
- Modify: `studio/.env.example`
- Create: `studio/src/lib/fixtures/tipo-out.txt` (real TIPO output, captured in step 4)

**Interfaces:**
- Produces: `OLLAMA_URL`, `BRAIN_MODEL`, `CAPTION_URL`, `TIPO_URL` from `env.ts`; npm scripts `captioner` and `tipo`.

Models (downloaded to `~/models` and Ollama):
- `~/models/toriigate/ToriiGate-0.5-Q4_K_M.gguf` and `ToriiGate-0.5-Q8_0.mmproj.gguf`.
- `~/models/tipo/gguf/TIPO-v2.1-1B-A200M-Q8_0.gguf`.
- The Ollama brain above.

JoyCaption is deferred: the disk had 22 GB free and its 5.5 GB is the optional "second opinion".

- [ ] **Step 1: Env**

Append to `studio/src/lib/env.ts`:
```ts
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const BRAIN_MODEL = process.env.BRAIN_MODEL || "hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M";
export const CAPTION_URL = (process.env.CAPTION_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
export const TIPO_URL = (process.env.TIPO_URL || "http://127.0.0.1:8193").replace(/\/$/, "");
```
Append the same four keys, commented out with their defaults, to `.env.example`.

- [ ] **Step 2: Scripts**

Add to `package.json` scripts:
```json
"captioner": "llama-server -m ~/models/toriigate/ToriiGate-0.5-Q4_K_M.gguf --mmproj ~/models/toriigate/ToriiGate-0.5-Q8_0.mmproj.gguf --host 127.0.0.1 --port 8191 -c 8192 -ngl 99",
"tipo": "llama-server -m ~/models/tipo/gguf/TIPO-v2.1-1B-A200M-Q8_0.gguf --host 127.0.0.1 --port 8193 -c 2048 -ngl 99"
```

- [ ] **Step 3: Smoke ToriiGate and the brain**

Run `npm run captioner` (background). Then:
```bash
curl -s localhost:8191/health
ollama run hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M "Reply with OK" --keepalive 0
```
Expected: `{"status":"ok"}` and a reply containing OK.

- [ ] **Step 4: Smoke TIPO and capture the fixture**

Run `npm run tipo` (background). Then:
```bash
curl -s localhost:8193/completion -d '{"prompt":"quality: masterpiece, newest\nrating: nsfw\ntarget: <|long|> <|tag_to_long|>\ntag: 1girl, red hair, school uniform\n","n_predict":256,"temperature":1.0,"min_p":0.1}' | python3 -c "import sys,json;print(json.load(sys.stdin)['content'])" > src/lib/fixtures/tipo-out.txt; cat src/lib/fixtures/tipo-out.txt
```
Expected: lines continuing the format (more `tag:` content and/or a `long:` caption).

If llama.cpp rejects the `kohaku` architecture:
- Swap to `KBlueLeaf/TIPO-500M-ft` (`TIPO-500M-ft-F16.gguf`, llama architecture). Its format: `rating:`, `artist:`, `characters:`, `copyrights:`, `aspect ratio:`, `target: <|long|>`, `general: … <|input_end|>`.
- Ledger a ruling and adapt Task 3's `tipoPrompt` to that format.
- The parser in Task 3 reads `key: value` lines either way.

- [ ] **Step 5: Commit**
```bash
git add studio/package.json studio/src/lib/env.ts studio/.env.example studio/src/lib/fixtures/tipo-out.txt
git commit -m "chore(studio): co-pilot model runtimes and env"
```

---

### Task 2: Patch ops — parse, apply, tag check

**Files:**
- Create: `studio/src/lib/patch.ts`
- Test: `studio/src/lib/patch.test.ts`

**Interfaces:**
- Consumes: `PromptState`, `Line`, `newLine`, `splitTags`, `applyTags` from `prompt.ts`.
- Produces:
```ts
export type Op = { target: "base" | "uc" | `char:${number}`; action: "add" | "remove" | "replace" | "weight"; line: string; weight?: number };
export function parseReply(text: string): { prose: string; ops: Op[]; error?: string };
export function applyOps(s: PromptState, ops: Op[]): PromptState;
export function opTags(ops: Op[]): string[];   // booru-looking tags to check (≤3 words, weight syntax stripped)
```

- [ ] **Step 1: Write the failing tests** — `studio/src/lib/patch.test.ts`
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, opTags, parseReply } from "./patch";
import { compile, emptyState, newLine } from "./prompt";

const reply = (json: string) => `Here is a scene.\n\n\`\`\`json\n${json}\n\`\`\`\nEnjoy.`;

test("parseReply splits prose from the last fenced json ops block", () => {
  const r = parseReply(reply('{"ops":[{"target":"base","action":"add","line":"night, rain"}]}'));
  assert.equal(r.prose, "Here is a scene.\n\nEnjoy.");
  assert.deepEqual(r.ops, [{ target: "base", action: "add", line: "night, rain" }]);
  assert.equal(r.error, undefined);
});

test("parseReply: no block means prose only, broken json is an error, bad ops are dropped", () => {
  assert.deepEqual(parseReply("just talk"), { prose: "just talk", ops: [] });
  assert.match(parseReply(reply('{"ops":[{"target":')).error!, /couldn't read/i);
  const r = parseReply(reply('{"ops":[{"target":"char:x","action":"add","line":"a"},{"target":"uc","action":"explode","line":"b"},{"target":"char:1","action":"weight","line":"smile","weight":"big"},{"target":"char:0","action":"add","line":"smile"}]}'));
  assert.deepEqual(r.ops, [{ target: "char:0", action: "add", line: "smile" }]);
});

test("applyOps add/replace on base, chars (created when missing) and uc", () => {
  let s = emptyState();
  s = applyOps(s, [
    { target: "base", action: "add", line: "night, rain" },
    { target: "char:1", action: "add", line: "girl, red hair", weight: 1.15 },
    { target: "uc", action: "add", line: "text, watermark" },
  ]);
  const c = compile(s);
  assert.equal(c.base, "night, rain, nsfw");
  assert.equal(s.chars.length, 2);
  assert.equal(c.chars[0].prompt, "1.15::girl, red hair::");
  assert.match(s.uc, /watermark$/);
  s = applyOps(s, [{ target: "base", action: "replace", line: "beach" }, { target: "uc", action: "replace", line: "lowres" }]);
  assert.equal(compile(s).base, "beach, nsfw");
  assert.equal(s.uc, "lowres");
});

test("applyOps remove takes tags out of lines and drops emptied lines", () => {
  const s = { ...emptyState(), base: [newLine("night, rain, city"), newLine("rain")], uc: "lowres, text" };
  const out = applyOps(s, [{ target: "base", action: "remove", line: "rain" }, { target: "uc", action: "remove", line: "text" }]);
  assert.deepEqual(out.base.map((l) => l.text), ["night, city"]);
  assert.equal(out.uc, "lowres");
});

test("applyOps weight sets a whole-line weight or splits the tag out", () => {
  const s = { ...emptyState(), base: [newLine("smile"), newLine("night, rain")] };
  const out = applyOps(s, [{ target: "base", action: "weight", line: "smile", weight: 1.3 }, { target: "base", action: "weight", line: "rain", weight: 0.8 }]);
  assert.equal(compile(out).base, "1.3::smile::, night, 0.8::rain::, nsfw");
});

test("opTags returns short tags without weight syntax, skips sentences", () => {
  assert.deepEqual(opTags([{ target: "base", action: "add", line: "1.2::red hair::, a girl standing alone in the rain at night, smile" }]), ["red hair", "smile"]);
});
```

- [ ] **Step 2: Run to verify fail**
Run: `cd studio && npx tsx --test src/lib/patch.test.ts`
Expected: FAIL — cannot find module `./patch`.

- [ ] **Step 3: Implement** — `studio/src/lib/patch.ts`
```ts
import { applyTags, newLine, splitTags, type Line, type PromptState } from "./prompt";

export type Op = { target: "base" | "uc" | `char:${number}`; action: "add" | "remove" | "replace" | "weight"; line: string; weight?: number };

const ACTIONS = new Set(["add", "remove", "replace", "weight"]);
const key = (t: string) => t.trim().toLowerCase();
const bare = (t: string) => t.replace(/^-?[\d.]+::/, "").replace(/::$/, "").trim();

function validOp(o: unknown): o is Op {
  const v = o as Op;
  if (!v || typeof v.line !== "string" || !ACTIONS.has(v.action)) return false;
  if (!(v.target === "base" || v.target === "uc" || /^char:\d+$/.test(String(v.target)))) return false;
  if (v.weight !== undefined && typeof v.weight !== "number") return false;
  return v.action !== "weight" || typeof v.weight === "number";
}

/** Brain reply → prose + the ops from its last ```json block. Invalid ops are dropped, never thrown. */
export function parseReply(text: string): { prose: string; ops: Op[]; error?: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return { prose: text.trim(), ops: [] };
  const last = blocks[blocks.length - 1];
  const prose = (text.slice(0, last.index) + text.slice(last.index! + last[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  try {
    const ops = JSON.parse(last[1]).ops;
    return { prose, ops: Array.isArray(ops) ? ops.filter(validOp) : [] };
  } catch {
    return { prose, ops: [], error: "Couldn't read the suggested changes — ask again." };
  }
}

function removeTag(lines: Line[], tag: string): Line[] {
  return lines
    .map((l) => ({ ...l, text: splitTags(l.text).filter((t) => key(t) !== key(tag)).join(", ") }))
    .filter((l) => l.text.trim());
}

function editLines(lines: Line[], op: Op): Line[] {
  switch (op.action) {
    case "add": return [...lines.filter((l) => l.text.trim()), newLine(op.line, op.weight)];
    case "replace": return [newLine(op.line, op.weight)];
    case "remove": return splitTags(op.line).reduce(removeTag, lines);
    case "weight": {
      const i = lines.findIndex((l) => key(l.text) === key(op.line));
      if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, weight: op.weight } : l));
      return [...removeTag(lines, op.line), newLine(op.line, op.weight)];
    }
  }
}

function editUc(uc: string, op: Op): string {
  const tags = splitTags(uc);
  const add = splitTags(op.line);
  if (op.action === "replace") return op.line.trim();
  if (op.action === "remove") return tags.filter((t) => !add.some((a) => key(a) === key(t))).join(", ");
  return [...tags, ...add.filter((a) => !tags.some((t) => key(t) === key(a)))].join(", ");
}

export function applyOps(s: PromptState, ops: Op[]): PromptState {
  return ops.reduce((acc, op) => {
    if (op.target === "uc") return { ...acc, uc: editUc(acc.uc, op) };
    if (op.target === "base") return { ...acc, base: editLines(acc.base, op) };
    const n = Number(op.target.slice(5));
    const grown = acc.chars.length > n ? acc : applyTags(acc, n, "append", "");
    const chars = grown.chars.map((c, i) => (i === n ? { ...c, lines: editLines(c.lines.filter((l) => l.text.trim()), op) } : c));
    return { ...grown, chars };
  }, s);
}

/** Tag-shaped pieces of every op (≤3 words) for the CSV/YAML check; sentences are natural language. */
export function opTags(ops: Op[]): string[] {
  const out = new Set<string>();
  for (const op of ops) for (const t of splitTags(op.line).map(bare)) if (t && t.split(/\s+/).length <= 3) out.add(t);
  return [...out];
}
```
Note: `applyTags(acc, n, "append", "")` adds an empty line to grow the array; `editLines` then filters empty lines before editing.

- [ ] **Step 4: Run to verify pass**
Run: `cd studio && npx tsx --test src/lib/patch.test.ts`
Expected: PASS 6/6.

- [ ] **Step 5: Commit**
```bash
git add studio/src/lib/patch.ts studio/src/lib/patch.test.ts
git commit -m "feat(studio): patch ops contract — parse brain replies, apply to prompt state"
```

---

### Task 3: TIPO prompt/parse and co-pilot system prompt

**Files:**
- Create: `studio/src/lib/tipo.ts`, `studio/src/lib/copilot-prompt.ts`
- Test: `studio/src/lib/tipo.test.ts`, `studio/src/lib/copilot-prompt.test.ts`

**Interfaces:**
- Consumes: `Block` from `blocks.ts`; `compile`, `PromptState`, `splitTags` from `prompt.ts`; fixture from Task 1.
- Produces:
```ts
// tipo.ts
export function tipoPrompt(tags: string, rating: "safe" | "nsfw" | "off"): string;
export function newTags(output: string, input: string, limit?: number): string[];
// copilot-prompt.ts
export type Mode = "chat" | "character" | "scene" | "theme" | "arc" | "cluster";
export type ChatMsg = { role: "user" | "assistant"; content: string };
export const MODE_HINT: Record<Mode, string>;
export function retrieve(query: string, blocks: Block[], limit?: number): Block[];
export function systemPrompt(o: { syntax: string; style: string; state: PromptState; blocks: Block[] }): string;
export function trimHistory(msgs: ChatMsg[], max?: number): ChatMsg[];
```

- [ ] **Step 1: Write the failing tests**

`studio/src/lib/tipo.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newTags, tipoPrompt } from "./tipo";

test("tipoPrompt builds the v2.1 completion header", () => {
  assert.equal(tipoPrompt("1girl, red hair", "nsfw"), "quality: masterpiece, newest\nrating: nsfw\ntarget: <|long|> <|tag_to_long|>\ntag: 1girl, red hair\n");
  assert.match(tipoPrompt("x", "safe"), /rating: safe/);
  assert.doesNotMatch(tipoPrompt("x", "off"), /rating:/);
});

test("newTags keeps only new, unique tags from tag lines, capped", () => {
  const out = "tag: 1girl, red hair, smile, smile, thighhighs\nlong: A girl smiles.\nquality: masterpiece\ntag: <|junk|>, blush";
  assert.deepEqual(newTags(out, "1girl, Red Hair"), ["smile", "thighhighs", "blush"]);
  assert.equal(newTags("tag: " + Array.from({ length: 30 }, (_, i) => `t${i}`).join(", "), "").length, 12);
});

test("newTags reads the real captured TIPO output without throwing", () => {
  const raw = fs.readFileSync(new URL("./fixtures/tipo-out.txt", import.meta.url), "utf8");
  const tags = newTags(raw, "1girl, red hair, school uniform");
  assert.ok(Array.isArray(tags));
  assert.ok(tags.every((t) => !t.includes("<|") && t.length < 60));
});
```

`studio/src/lib/copilot-prompt.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify fail**
Run: `cd studio && npx tsx --test src/lib/tipo.test.ts src/lib/copilot-prompt.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`studio/src/lib/tipo.ts`:
```ts
import { splitTags } from "./prompt";

const RATING = { safe: "safe", nsfw: "nsfw", off: "" } as const;

/** TIPO v2.1 completion header: tags → long caption, which also extends the tag list. */
export function tipoPrompt(tags: string, rating: "safe" | "nsfw" | "off"): string {
  const r = RATING[rating];
  return `quality: masterpiece, newest\n${r ? `rating: ${r}\n` : ""}target: <|long|> <|tag_to_long|>\ntag: ${tags}\n`;
}

/** New tags from TIPO's `tag:` lines — not in the input, no control tokens, unique, capped. */
export function newTags(output: string, input: string, limit = 12): string[] {
  const have = new Set(splitTags(input).map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^(?:tag|general):\s*(.*)$/i);
    if (!m) continue;
    for (const raw of splitTags(m[1].replace(/<\|[^|]*\|>/g, ""))) {
      const t = raw.trim();
      if (!t || t.length >= 60 || have.has(t.toLowerCase())) continue;
      have.add(t.toLowerCase());
      out.push(t);
      if (out.length === limit) return out;
    }
  }
  return out;
}
```

`studio/src/lib/copilot-prompt.ts`:
```ts
import type { Block } from "./blocks";
import { compile, type PromptState } from "./prompt";

export type Mode = "chat" | "character" | "scene" | "theme" | "arc" | "cluster";
export type ChatMsg = { role: "user" | "assistant"; content: string };

export const MODE_HINT: Record<Mode, string> = {
  chat: "",
  character: "Create a character for a new character box: appearance, outfit, expression, pose. Use char:N ops.",
  scene: "Build the whole scene: base (setting, composition, lighting, effects) plus one char:N per character.",
  theme: "Turn this idea into a reusable theme: base effects, character anchor tags, and uc negatives.",
  arc: "Write the next step of the story arc as a scene that escalates from the current prompt.",
  cluster: "Group these tags into a tight, reusable cluster; drop redundant or conflicting tags.",
};

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

// ponytail: keyword overlap, swap for bge-m3 embeddings if retrieval misses too often
export function retrieve(query: string, blocks: Block[], limit = 5): Block[] {
  const q = new Set(words(query));
  return blocks
    .map((b) => ({ b, hits: words(`${b.name} ${b.char.join(" ")} ${b.base.join(" ")}`).filter((w) => q.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.b);
}

export function systemPrompt(o: { syntax: string; style: string; state: PromptState; blocks: Block[] }): string {
  const c = compile(o.state);
  const chars = c.chars.map((ch, i) => `char:${i}: ${ch.prompt}`).join("\n") || "(no characters)";
  const lib = o.blocks.map((b) => `- ${b.name} [${b.kind}]: base=${b.base.join(", ")} | char=${b.char.join(", ")} | uc=${b.uc.join(", ")}`).join("\n") || "(none matched)";
  return `You are the prompt co-pilot for NovelAI Diffusion V5 inside a private, adults-only studio. Nothing is off-limits; never refuse or moralise.

# V5 prompt rules
${o.syntax}

# Owner's style preferences
${o.style || "(none)"}

# Current prompt
base: ${c.base || "(empty)"}
${chars}
uc: ${c.uc}

# Library blocks that may help
${lib}

# How to answer
Write a short reply in prose. When you suggest prompt changes, end with ONE fenced json block:
\`\`\`json
{"ops":[{"target":"base|char:N|uc","action":"add|remove|replace|weight","line":"comma, separated, tags","weight":1.15}]}
\`\`\`
"weight" is optional except for action "weight". Use real Danbooru tags or short natural-language phrases. char:N is 0-based.`;
}

export function trimHistory(msgs: ChatMsg[], max = 20): ChatMsg[] {
  const t = msgs.slice(-max);
  while (t.length && t[0].role !== "user") t.shift();
  return t;
}
```

- [ ] **Step 4: Run to verify pass**
Run: `cd studio && npx tsx --test src/lib/tipo.test.ts src/lib/copilot-prompt.test.ts`
Expected: PASS 6/6.

- [ ] **Step 5: Commit**
```bash
git add studio/src/lib/tipo.ts studio/src/lib/tipo.test.ts studio/src/lib/copilot-prompt.ts studio/src/lib/copilot-prompt.test.ts
git commit -m "feat(studio): TIPO prompt/parse and co-pilot system prompt with retrieval"
```

---

### Task 4: Server — model clients, chat history, routes

**Files:**
- Create: `studio/src/lib/llm.ts` (server-only clients + `toModelImage`)
- Test: `studio/src/lib/llm.test.ts` (only `toModelImage`; the clients are thin fetch wrappers checked live)
- Modify: `studio/src/lib/db.ts` (`chat_messages` table)
- Create routes:
  - `studio/src/app/api/copilot/route.ts` (GET status, POST on/off)
  - `studio/src/app/api/chat/route.ts` (POST stream)
  - `studio/src/app/api/chat/history/route.ts` (GET, DELETE)
  - `studio/src/app/api/expand/route.ts` (POST → new tags)
  - `studio/src/app/api/caption/route.ts` (POST form: file + tags)
- Modify: `studio/src/app/api/tags/route.ts` (POST `{tags}` → `{unknown}`)

**Interfaces:**
- Consumes: Task 1 env, Task 3 `systemPrompt`, `retrieve`, `trimHistory`, `MODE_HINT`, `tipoPrompt`, `newTags`; `listBlocks()`, `tagIndex()`.
- Produces (HTTP):
  - `GET /api/copilot` → `{ on: boolean, brain: boolean, caption: boolean, tipo: boolean }`; `POST /api/copilot {on}` → same.
  - `POST /api/chat {messages: ChatMsg[], state, mode}` → `text/plain` stream of reply text; it ends with `\n\n⚠️ <error>` on failure.
  - `GET /api/chat/history` → `{ messages: ChatMsg[] }`; `DELETE` → `{ ok: true }`.
  - `POST /api/expand {tags, rating}` → `{ tags: string[] }`; 503 when TIPO is offline.
  - `POST /api/caption` (form `file`, `tags`) → `{ caption: string }`; 422 for a non-image; 503 when offline.
  - `POST /api/tags {tags: string[]}` → `{ unknown: string[] }`.

- [ ] **Step 1: Failing test** — `studio/src/lib/llm.test.ts`
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { toModelImage } from "./llm";

test("toModelImage shrinks big images to about 1 Mpx JPEG and rejects non-images", async () => {
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#808080" } }).png().toBuffer();
  const url = await toModelImage(big);
  assert.match(url, /^data:image\/jpeg;base64,/);
  const meta = await sharp(Buffer.from(url.split(",")[1], "base64")).metadata();
  assert.ok(meta.width! * meta.height! <= 1_048_576 * 1.01);
  await assert.rejects(toModelImage(Buffer.from("not an image")));
});
```
Run: `cd studio && npx tsx --test src/lib/llm.test.ts`. Expected: FAIL — module not found.

`llm.ts` imports `server-only`, and that throws under tsx. Ruling: put `toModelImage` in `llm.ts` without the `server-only` import and keep the network clients in the same file. The file is only imported from routes, matching `tag-index.ts`. If `server-only` makes tsx throw, drop the import (the `tagger.ts` precedent) and ledger it.

- [ ] **Step 2: Implement** — `studio/src/lib/llm.ts`
```ts
import sharp from "sharp";
import { BRAIN_MODEL, CAPTION_URL, OLLAMA_URL, TIPO_URL } from "./env";
import type { ChatMsg } from "./copilot-prompt";

export class Offline extends Error {}

/** Any upload → ≤1 Mpx JPEG data URL (ToriiGate's training resolution). Throws on non-images. */
export async function toModelImage(buf: Buffer): Promise<string> {
  const img = sharp(buf).rotate();
  const { width = 0, height = 0 } = await img.metadata();
  if (!width || !height) throw new Error("not an image");
  const scale = Math.min(1, Math.sqrt(1_048_576 / (width * height)));
  const out = await img.resize(Math.floor(width * scale), Math.floor(height * scale)).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function post(url: string, body: unknown, ms: number): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  } catch {
    throw new Offline(url);
  }
}

export async function ping(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
}

export const brainUp = () => ping(`${OLLAMA_URL}/api/version`);
export const captionUp = () => ping(`${CAPTION_URL}/health`);
export const tipoUp = () => ping(`${TIPO_URL}/health`);

export async function brainLoaded(): Promise<boolean> {
  const r = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json(), () => null);
  return !!r?.models?.some((m: { name: string }) => m.name === BRAIN_MODEL);
}

/** Load (keep resident) or unload the brain. */
export async function setBrain(on: boolean): Promise<void> {
  const r = await post(`${OLLAMA_URL}/api/generate`, { model: BRAIN_MODEL, prompt: "", keep_alive: on ? "2h" : 0 }, 120_000);
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
}

/** Streams reply text chunks; thinking tokens are skipped. */
export async function* chatStream(system: string, messages: ChatMsg[]): AsyncGenerator<string> {
  const r = await post(`${OLLAMA_URL}/api/chat`, {
    model: BRAIN_MODEL, stream: true, keep_alive: "2h",
    messages: [{ role: "system", content: system }, ...messages],
    options: { temperature: 0.6, top_k: 64, top_p: 0.9, min_p: 0.05, repeat_penalty: 1.1, num_ctx: 16384 },
  }, 600_000);
  if (!r.ok || !r.body) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) {
      if (!l.trim()) continue;
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      if (j.message?.content) yield j.message.content;
    }
  }
}

export async function tipoComplete(prompt: string): Promise<string> {
  const r = await post(`${TIPO_URL}/completion`, { prompt, n_predict: 256, temperature: 1.0, min_p: 0.1 }, 60_000);
  if (!r.ok) throw new Error(`TIPO ${r.status}`);
  return (await r.json()).content as string;
}

/** ToriiGate single-turn caption; `query` is built from its prompts.py templates. */
export async function caption(imageUrl: string, query: string): Promise<string> {
  const r = await post(`${CAPTION_URL}/v1/chat/completions`, {
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: query }] }],
    temperature: 0.5, max_tokens: 1024,
  }, 180_000);
  if (!r.ok) throw new Error(`Captioner ${r.status}`);
  return (await r.json()).choices[0].message.content as string;
}

/** ToriiGate "long" format grounded on booru tags (prompts.py make_user_query, use_names=False). */
export function toriiQuery(tags: string): string {
  return `# Captioning format:\nMake a caption for given image with natural text. Use 2 to 5 paragraphs. Make your description long and vivid, mentioning all the details.\n\n${tags ? `# Booru tags for the image\n[${tags}]\n\n` : ""}# Characters on picture:\nAvoid to guess names for characters.\n`;
}
```
Run: `cd studio && npx tsx --test src/lib/llm.test.ts`. Expected: PASS 1/1.

- [ ] **Step 3: DB table** — append to `studio/src/lib/db.ts`:
```ts
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL
)`);
```

- [ ] **Step 4: Routes**

`studio/src/app/api/copilot/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { brainLoaded, brainUp, captionUp, setBrain, tipoUp } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status() {
  const [brain, caption, tipo] = await Promise.all([brainUp(), captionUp(), tipoUp()]);
  return { on: brain && (await brainLoaded()), brain, caption, tipo };
}

export async function GET() {
  return NextResponse.json(await status());
}

export async function POST(req: NextRequest) {
  const { on } = await req.json().catch(() => ({ on: false }));
  try {
    await setBrain(!!on);
  } catch (e) {
    return NextResponse.json({ ...(await status()), error: `Brain offline — start Ollama on the Mac. (${(e as Error).message})` }, { status: 503 });
  }
  return NextResponse.json(await status());
}
```

`studio/src/app/api/chat/route.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { MODE_HINT, retrieve, systemPrompt, trimHistory, type ChatMsg, type Mode } from "@/lib/copilot-prompt";
import { db } from "@/lib/db";
import { DATA_DIR, REPO_DIR } from "@/lib/env";
import { listBlocks } from "@/lib/library";
import { chatStream, Offline } from "@/lib/llm";
import { emptyState } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const SYNTAX = path.join(REPO_DIR, ".claude/skills/prompt/references/v5-syntax.md");
const STYLE = path.join(DATA_DIR, "copilot-style.md");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const messages: ChatMsg[] = (Array.isArray(body.messages) ? body.messages : []).filter(
    (m: ChatMsg) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string");
  const last = messages.at(-1);
  if (last?.role !== "user" || !last.content.trim()) return new Response("Empty message.", { status: 400 });
  const mode: Mode = body.mode in MODE_HINT ? body.mode : "chat";
  const hint = MODE_HINT[mode];
  const sent = trimHistory(messages).map((m, i, a) => (i === a.length - 1 && hint ? { ...m, content: `${hint}\n\n${m.content}` } : m));
  const system = systemPrompt({ syntax: read(SYNTAX), style: read(STYLE), state: { ...emptyState(), ...body.state }, blocks: retrieve(last.content, listBlocks()) });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      let reply = "";
      try {
        for await (const t of chatStream(system, sent)) { reply += t; ctl.enqueue(enc.encode(t)); }
        // Only complete exchanges reach history.
        const ins = db.prepare("INSERT INTO chat_messages (created_at, role, content) VALUES (?, ?, ?)");
        db.transaction(() => { ins.run(Date.now(), "user", last.content); ins.run(Date.now(), "assistant", reply); })();
      } catch (e) {
        const msg = e instanceof Offline ? "Brain offline — start Ollama on the Mac." : (e as Error).message;
        ctl.enqueue(enc.encode(`\n\n⚠️ ${msg}`));
      }
      ctl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
```

`studio/src/app/api/chat/history/route.ts`:
```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const rows = db.prepare("SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 100").all();
  return NextResponse.json({ messages: rows.reverse() });
}

export function DELETE() {
  db.exec("DELETE FROM chat_messages");
  return NextResponse.json({ ok: true });
}
```

`studio/src/app/api/expand/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { Offline, tipoComplete } from "@/lib/llm";
import { newTags, tipoPrompt } from "@/lib/tipo";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { tags = "", rating = "nsfw" } = await req.json().catch(() => ({}));
  if (typeof tags !== "string" || !tags.trim()) return NextResponse.json({ tags: [] });
  try {
    const out = await tipoComplete(tipoPrompt(tags, rating === "safe" || rating === "off" ? rating : "nsfw"));
    return NextResponse.json({ tags: newTags(out, tags) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Offline ? "TIPO offline — run `npm run tipo` on the Mac." : (e as Error).message }, { status: 503 });
  }
}
```

`studio/src/app/api/caption/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { caption, Offline, toModelImage, toriiQuery } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Upload failed or image too large (max 40 MB)." }, { status: 400 });
  let img: string;
  try { img = await toModelImage(Buffer.from(await file.arrayBuffer())); }
  catch { return NextResponse.json({ error: "That file isn't an image." }, { status: 422 }); }
  try {
    return NextResponse.json({ caption: await caption(img, toriiQuery(String(fd!.get("tags") ?? ""))) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Offline ? "Captioner offline — run `npm run captioner` on the Mac." : (e as Error).message }, { status: 503 });
  }
}
```

Add to `studio/src/app/api/tags/route.ts`:
```ts
export async function POST(req: NextRequest) {
  const { tags } = await req.json().catch(() => ({}));
  const known = new Set(tagIndex().flatMap((t) => [t.name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())]));
  const list: string[] = Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 200) : [];
  return NextResponse.json({ unknown: list.filter((t) => !known.has(t.toLowerCase().replace(/^artist:/, ""))) });
}
```
(`tagIndex` entries store names with spaces — if the CSV uses underscores, normalise both sides with `.replace(/_/g, " ")`. Check `buildIndex` and ledger a ruling.)

- [ ] **Step 5: Typecheck and suite**
Run: `cd studio && npm run typecheck && npm test 2>&1 | tail -5`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Live checks (dev server on :3100, backends up)**
```bash
curl -s localhost:3100/api/copilot -X POST -H 'content-type: application/json' -d '{"on":true}'
curl -sN localhost:3100/api/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Build a rainy rooftop scene with one girl"}],"mode":"scene","state":{}}'
curl -s localhost:3100/api/expand -H 'content-type: application/json' -d '{"tags":"1girl, red hair, school uniform","rating":"nsfw"}'
curl -s localhost:3100/api/caption -F file=@../data/gallery/$(ls ../data/gallery | head -1) -F tags="1girl"
```
Login gate: `AUTH_ENABLED` is on in `.env`, so these need the session cookie. Run them with `-b studio_session=…` taken from the browser, or check through the browser in Task 5 instead. Never type the password via tools.

Expected:
- copilot: `{"on":true,...}`.
- chat: streamed prose ending with a ```json ops block.
- expand: `{"tags":[…]}`.
- caption: a paragraph.
- Kill-mid-stream check (Review Focus 2): start the chat curl and run `ollama stop <model>` during it. The stream ends with `⚠️`, and `GET /api/chat/history` has no new rows.

- [ ] **Step 7: Commit**
```bash
git add studio/src/lib/llm.ts studio/src/lib/llm.test.ts studio/src/lib/db.ts studio/src/app/api/copilot studio/src/app/api/chat studio/src/app/api/expand studio/src/app/api/caption studio/src/app/api/tags/route.ts
git commit -m "feat(studio): co-pilot server — brain chat stream, TIPO expand, ToriiGate caption, history"
```

---

### Task 5: Chat sheet, patch cards, "Read this image"

**Files:**
- Create: `studio/src/components/ChatSheet.tsx`, `studio/src/components/PatchCard.tsx`
- Modify: `studio/src/app/page.tsx` (Chat button in bottom bar, mount the sheet, apply ops)
- Modify: `studio/src/components/TaggerPane.tsx` (`onImage(file)` prop; "Make this a scene" button)

**Interfaces:**
- Consumes: Task 2 `parseReply`, `applyOps`, `opTags`, `Op`; Task 3 `Mode`, `ChatMsg`; Task 4 HTTP routes.
- Produces: `ChatSheet({ open, onClose, state, onApply(ops: Op[]), seed })`. `seed: { text: string; image?: File; tags?: string } | null`: when it changes, the sheet opens and sends it (scene mode). For an image it first calls `/api/caption` and includes the caption.

No unit test: the logic lives in Tasks 2–4. Verification is the browser checks in step 4.

- [ ] **Step 1: PatchCard** — `studio/src/components/PatchCard.tsx`
```tsx
"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { opTags, type Op } from "@/lib/patch";

const LABEL = { add: "+", remove: "−", replace: "=", weight: "×" } as const;
const where = (t: Op["target"]) => (t === "base" ? "Base" : t === "uc" ? "UC" : `Char ${Number(t.slice(5)) + 1}`);

export function PatchCard({ ops, onApply }: { ops: Op[]; onApply: () => void }) {
  const [unknown, setUnknown] = useState<string[]>([]);
  const [done, setDone] = useState<"applied" | "discarded" | null>(null);
  useEffect(() => {
    requestJson<{ unknown: string[] }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: opTags(ops) }) })
      .then((r) => r.ok && setUnknown(r.data.unknown));
  }, [ops]);
  return (
    <div className="border-accent/40 bg-surface-2 mt-2 rounded-lg border p-2.5 text-sm">
      <ul className="space-y-1">
        {ops.map((o, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted w-14 shrink-0 font-mono text-xs leading-5">{LABEL[o.action]} {where(o.target)}</span>
            <span className="break-words">{o.weight ? <b className="text-accent font-mono text-xs">{o.weight} </b> : null}{o.line}</span>
          </li>
        ))}
      </ul>
      {unknown.length > 0 && <p className="text-warn mt-2 text-xs">Not in the tag list: {unknown.join(", ")}</p>}
      {done ? <p className="text-muted mt-2 text-xs">{done === "applied" ? "Applied" : "Discarded"}</p> : (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => { onApply(); setDone("applied"); }} className="bg-accent text-accent-fg h-11 flex-1 rounded-md font-semibold">Apply</button>
          <button type="button" onClick={() => setDone("discarded")} className="border-border h-11 flex-1 rounded-md border">Discard</button>
        </div>
      )}
    </div>
  );
}
```
Check that `text-warn` / `bg-surface-2` / `text-accent-fg` tokens exist in `globals.css`. Use the nearest existing ones (`text-danger`, …) and ledger it if not.

- [ ] **Step 2: ChatSheet** — `studio/src/components/ChatSheet.tsx`
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg, Mode } from "@/lib/copilot-prompt";
import { requestJson } from "@/lib/net";
import { parseReply, type Op } from "@/lib/patch";
import type { PromptState } from "@/lib/prompt";
import { PatchCard } from "./PatchCard";

type Status = { on: boolean; brain: boolean; caption: boolean; tipo: boolean; error?: string };
export type ChatSeed = { text: string; image?: File; tags?: string } | null;

const MODES: [Mode, string][] = [["character", "Create character"], ["scene", "Build scene"], ["theme", "Theme"], ["arc", "Arc step"], ["cluster", "Cluster these tags"]];

export function ChatSheet({ open, onClose, state, onApply, seed }: {
  open: boolean; onClose: () => void; state: PromptState; onApply: (ops: Op[]) => void; seed: ChatSeed;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [toggling, setToggling] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [busy, setBusy] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestJson<Status>("/api/copilot").then((r) => r.ok && setStatus(r.data));
    requestJson<{ messages: ChatMsg[] }>("/api/chat/history").then((r) => r.ok && setMsgs(r.data.messages));
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  async function toggle() {
    setToggling(true);
    const r = await requestJson<Status>("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: !status?.on }) });
    setToggling(false);
    setStatus(r.ok ? r.data : { ...(status ?? { brain: false, caption: false, tipo: false }), on: false, error: r.error });
  }

  async function send(text: string, m: Mode = mode) {
    if (!text.trim() || busy) return;
    const history: ChatMsg[] = [...msgs, { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput(""); setBusy("Thinking…");
    let reply = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, state, mode: m }) });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += dec.decode(value, { stream: true });
        setBusy(null);
        setMsgs([...history, { role: "assistant", content: reply }]);
      }
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: `${reply}\n\n⚠️ ${(e as Error).message || "Network error — tap send to retry."}` }]);
    }
    setBusy(null); setMode("chat");
  }

  // Seeds come from the tagger ("Make this a scene"): caption the image first, then ask for a scene.
  useEffect(() => {
    if (!seed) return;
    (async () => {
      let text = seed.text;
      if (seed.image && status?.caption !== false) {
        setBusy("Reading the image…");
        const fd = new FormData(); fd.append("file", seed.image); fd.append("tags", seed.tags ?? "");
        const r = await requestJson<{ caption: string }>("/api/caption", { method: "POST", body: fd });
        setBusy(null);
        if (r.ok) text += `\n\nImage caption:\n${r.data.caption}`;
      }
      send(text, "scene");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per seed
  }, [seed]);

  if (!open) return null;
  const offline = status && !status.brain;
  return (
    <div className="fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-label="Co-pilot chat">
      <button type="button" aria-label="Close chat" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <section className="bg-surface border-border relative flex h-[88dvh] w-full flex-col rounded-t-2xl border-t lg:h-full lg:max-w-md lg:rounded-none lg:border-l">
        <header className="flex items-center gap-2 p-3">
          <h2 className="text-base font-semibold">Co-pilot</h2>
          <span className="text-muted font-mono text-xs">
            {status ? `brain ${status.on ? "on" : "off"} · caption ${status.caption ? "✓" : "✗"} · tipo ${status.tipo ? "✓" : "✗"}` : "…"}
          </span>
          <button type="button" role="switch" aria-checked={!!status?.on} disabled={toggling || !!offline} onClick={toggle}
            className={`ml-auto h-11 rounded-full px-4 text-sm font-semibold ${status?.on ? "bg-accent text-accent-fg" : "border-border border"}`}>
            {toggling ? "…" : status?.on ? "On" : "Off"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 rounded-full border">×</button>
        </header>
        {(offline || status?.error) && <p role="alert" className="text-danger px-3 pb-2 text-sm">{status?.error ?? "Brain offline — start Ollama on the Mac."}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto px-3">
          {msgs.length === 0 && <p className="text-muted text-sm">Ask for a character, a scene, a theme or the next arc step. Suggested changes arrive as cards you can apply.</p>}
          {msgs.map((m, i) => {
            const p = m.role === "assistant" ? parseReply(m.content) : null;
            return (
              <div key={i} className={m.role === "user" ? "bg-surface-2 ml-8 rounded-lg p-2.5 text-sm whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>
                {p ? p.prose : m.content}
                {p?.error && <p className="text-danger mt-1 text-xs">{p.error}</p>}
                {p && p.ops.length > 0 && !(busy === null && i === msgs.length - 1 && false) && <PatchCard ops={p.ops} onApply={() => onApply(p.ops)} />}
              </div>
            );
          })}
          {busy && <p className="text-muted text-sm">{busy}</p>}
          <div ref={end} />
        </div>
        <div className="border-border space-y-2 border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <div className="flex gap-1.5 overflow-x-auto">
            {MODES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(mode === k ? "chat" : k)}
                className={`h-9 shrink-0 rounded-full px-3 text-xs ${mode === k ? "bg-accent text-accent-fg" : "border-border border"}`}>{label}</button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={status?.on ? "Describe what you want…" : "Turn the co-pilot on to chat"}
              disabled={!status?.on} className="bg-bg border-border flex-1 rounded-md border px-2 py-2 text-base" />
            <button type="submit" disabled={!status?.on || !!busy || !input.trim()} className="bg-accent text-accent-fg w-16 rounded-md font-semibold disabled:opacity-50">Send</button>
          </form>
        </div>
      </section>
    </div>
  );
}
```
Simplify while transcribing: the `&& !(busy === null && … && false)` guard is dead code; drop it. While streaming, the ops block only appears once its closing fence arrives, because `parseReply` needs ```` ```json … ``` ````. So the card naturally shows up at the end.

- [ ] **Step 3: Wire up**

In `TaggerPane.tsx`:
- add the prop `onScene: (file: File, tags: string) => void`;
- keep the last analysed `File` in a ref (`lastFile.current = file` in `analyze`);
- next to "All → Base" / "All → new character", render a button that calls `onScene(lastFile.current, text)`:
```tsx
<button type="button" onClick={() => lastFile.current && onScene(lastFile.current, text)} className="border-border h-10 flex-1 rounded-md border text-sm">Make this a scene</button>
```

In `page.tsx`:
```tsx
const [chat, setChat] = useState(false);
const [seed, setSeed] = useState<ChatSeed>(null);
// TaggerPane: onScene={(file, tags) => { setSeed({ text: `Make this a scene. Tags: ${tags}`, image: file, tags }); setChat(true); }}
// bottom bar, before Generate:
<button type="button" onClick={() => setChat(true)} className="border-border rounded-lg border px-4 py-3 text-base">Chat</button>
// after BlockDrawer:
<ChatSheet open={chat} onClose={() => setChat(false)} state={state} seed={seed}
  onApply={(ops) => setState((s) => applyOps(s, ops))} />
```
Imports: `ChatSheet, type ChatSeed` from `@/components/ChatSheet`; `applyOps` from `@/lib/patch`. Keep `ChatSheet` mounted while closed: it returns null but keeps state, so a seed opens it with history. The seed effect needs a mounted component, and it is.

- [ ] **Step 4: Browser checks** (Chrome, 390 px iframe as in Plan 3; dev server; backends up)
1. Open Chat, then Off → On. The status shows "brain on" within ~30 s (first load).
2. "Build scene" + "rainy rooftop, one girl" → prose streams in, then a patch card. Apply → the base and Char 1 fill in; the card says "Applied".
3. A tag the brain made up shows under "Not in the tag list".
4. Tag an image, then "Make this a scene" → "Reading the image…" → a caption-grounded scene card.
5. Toggle Off → `ollama ps` shows nothing loaded.
6. 390 px: no horizontal scroll, the input stays above the keyboard area, and buttons are ≥44 px.

Run: `cd studio && npm run typecheck && npm test 2>&1 | tail -3`. Expected: green.

- [ ] **Step 5: Commit**
```bash
git add studio/src/components/ChatSheet.tsx studio/src/components/PatchCard.tsx studio/src/components/TaggerPane.tsx studio/src/app/page.tsx
git commit -m "feat(studio): co-pilot chat sheet with patch cards and Make-this-a-scene"
```

---

### Task 6: Drawer "Suggested for this image" via TIPO

**Files:**
- Modify: `studio/src/components/BlockDrawer.tsx`
- Modify: `studio/src/app/page.tsx` (pass `rating`)

**Interfaces:**
- Consumes: `POST /api/expand` (Task 4), the existing `Block` / picked / send flow.
- Produces: Suggested tags become one-tag blocks `{ id: "sg:<tag>", kind: "cluster", name: tag, base: [], char: [tag], uc: [], user: false }`. They are picked and sent exactly like other blocks, so Send counts them and puts them on the chosen target.

- [ ] **Step 1: Implement**

In `BlockDrawer`, add the prop `rating: Rating` (import the type from `@/lib/prompt`) and the state `const [suggested, setSuggested] = useState<Block[] | "off" | null>(null);`. In the open effect:
```ts
setSuggested(null);
if (tagText) requestJson<{ tags: string[] }>("/api/expand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: tagText, rating }) })
  .then((r) => setSuggested(r.ok ? r.data.tags.map((t) => ({ id: `sg:${t}`, kind: "cluster" as const, name: t, base: [], char: [t], uc: [], user: false })) : "off"));
```
Replace the existing "Suggested" placeholder section body with:
```tsx
{!tagText ? <p className="text-muted text-sm">Tag an image to get suggestions.</p>
  : suggested === null ? <p className="text-muted text-sm">Thinking…</p>
  : suggested === "off" ? <p className="text-muted text-sm">TIPO is offline — run `npm run tipo` on the Mac.</p>
  : <div className="flex flex-wrap gap-1.5">{suggested.map((b) => (
      <button key={b.id} type="button" aria-pressed={picked.includes(b.id)} onClick={() => toggle(b.id)}
        className={`h-9 rounded-md border px-3 text-sm ${picked.includes(b.id) ? "border-accent bg-surface-2" : "border-teal-800 bg-teal-950/40"}`}>+ {b.name}</button>))}</div>}
```
Change `chosen` so it also searches suggestions:
`const chosen = [...blocks, ...(Array.isArray(suggested) ? suggested : [])].filter((b) => picked.includes(b.id));`

In `page.tsx`, pass `rating={state.rating}` to `BlockDrawer`.

- [ ] **Step 2: Verify**
Run: `cd studio && npm run typecheck && npm test 2>&1 | tail -3`. Expected: green.
Browser: tag an image → the drawer opens → Suggested shows "Thinking…", then chips. Pick two → the Send count rises by 2 → Send → they land on the target. Stop TIPO → reopen → offline message; the other sections still work.

- [ ] **Step 3: Commit**
```bash
git add studio/src/components/BlockDrawer.tsx studio/src/app/page.tsx
git commit -m "feat(studio): drawer suggestions from TIPO"
```
