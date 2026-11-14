import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleMessages, substituteMacros, type LoreEntry } from "./prompt";
import { DEFAULT_RP_SETTINGS, type RpCharacter, type RpChat, type RpPersona } from "./types";

const char = (o: Partial<RpCharacter> = {}): RpCharacter => ({
  id: 1, name: "Mio", avatarPath: null, description: "{{char}} teases {{user}}.", personality: "bratty", scenario: "", firstMessage: "",
  exampleDialogue: "", systemPrompt: "", postHistoryInstructions: "", alternateGreetings: "[]", creatorNotes: "", tags: "[]",
  lorebookId: null, worldLorebookId: null, model: null, samplerOverrides: null, appearancePrompt: "", outfitPrompt: "", bodyProps: "",
  agency: null, povMode: "", tense: "", dialogueStyle: "", stateSchema: "[]", displayName: "", profile: null, createdAt: 0, updatedAt: 0, ...o,
});
const persona: RpPersona = { id: 1, name: "Phil", description: "", avatarPath: null, isDefault: 1, relationship: "", addressAs: "", boundaries: "", createdAt: 0, updatedAt: 0 };
const chat = (o: Partial<RpChat> = {}): RpChat => ({
  id: 1, characterId: 1, personaId: 1, title: "", model: null, lorebookId: null, showBackground: 1, authorNote: "", authorNoteDepth: 4,
  wallpaperPath: null, replyLength: null, replySpice: null, replyAgency: null, memorySummary: "", summarizedThrough: 0, mods: "", stateValues: "{}", style: "",
  createdAt: 0, updatedAt: 0, ...o,
});
const lore = (o: Partial<LoreEntry>): LoreEntry => ({ keys: [], secondaryKeys: [], content: "", enabled: true, constant: false, scanDepth: 0, position: "after", probability: 100, insertionOrder: 0, ...o });
const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i} ${"x".repeat(400)}` }));
const all = (r: ReturnType<typeof assembleMessages>) => r.messages.map((m) => m.content).join("\n---\n");

test("macros are substituted with character and persona names", () => {
  assert.equal(substituteMacros("{{char}} sees {{user}} <BOT>", "Mio", "Phil"), "Mio sees Phil Mio");
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat(), history: [{ role: "user", content: "hi {{char}}" }] });
  assert.match(all(r), /Mio teases Phil\./);
  assert.match(all(r), /hi Mio/);
});

test("lore: keyed entry fires only when its key is in recent turns; constants always; disabled never", () => {
  const book = [lore({ keys: ["castle"], content: "CASTLE-LORE" }), lore({ constant: true, content: "ALWAYS-LORE" }), lore({ keys: ["castle"], enabled: false, content: "OFF-LORE" })];
  const quiet = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat(), history: [{ role: "user", content: "hello" }], lore: book });
  assert.doesNotMatch(all(quiet), /CASTLE-LORE/);
  assert.match(all(quiet), /ALWAYS-LORE/);
  const hit = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat(), history: [{ role: "user", content: "to the castle!" }], lore: book });
  assert.match(all(hit), /CASTLE-LORE/);
  assert.doesNotMatch(all(hit), /OFF-LORE/);
  assert.equal(hit.loreCount, 2);
});

test("lore over its budget share is dropped and counted", () => {
  const settings = { ...DEFAULT_RP_SETTINGS, numCtx: 4096, loreBudgetPct: 5 };
  const big = [lore({ constant: true, content: "a".repeat(400), insertionOrder: 0 }), lore({ constant: true, content: "b".repeat(4000), insertionOrder: 1 })];
  const r = assembleMessages({ settings, character: char(), persona, chat: chat(), history: [{ role: "user", content: "hi" }], lore: big });
  assert.equal(r.loreDropped, 1);
});

test("history is trimmed oldest-first to the budget, newest turn kept", () => {
  const settings = { ...DEFAULT_RP_SETTINGS, numCtx: 2048 };
  const h = turns(60);
  const r = assembleMessages({ settings, character: char(), persona, chat: chat(), history: h });
  assert.equal(r.truncated, true);
  assert.match(all(r), /turn 59 /);
  assert.doesNotMatch(all(r), /turn 0 /);
});

test("author's note sits authorNoteDepth messages from the end", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat({ authorNote: "NOTE", authorNoteDepth: 2 }), history: turns(6) });
  const idx = r.messages.findIndex((m) => m.content === "NOTE");
  const lastTurn = r.messages.findIndex((m) => m.content.startsWith("turn 5 "));
  assert.equal(lastTurn - idx, 2);
});

test("memory summary goes before history as 'Story so far'", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat({ memorySummary: "They met." }), history: turns(2) });
  const mem = r.messages.findIndex((m) => m.content.startsWith("[Story so far]"));
  assert.ok(mem >= 0 && mem < r.messages.findIndex((m) => m.content.startsWith("turn 0 ")));
});

test("voice lines go in the final block; the story block in the first system message", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char(), persona, chat: chat(), history: turns(2), voiceLines: [{ text: "Hmph, baka.", context: "" }], storyBlock: "Likes slow burn." });
  assert.match(r.messages.at(-1)!.content, /Hmph, baka\./);
  assert.match(r.messages[0].content, /\[How the owner likes stories\]\nLikes slow burn\./);
});
