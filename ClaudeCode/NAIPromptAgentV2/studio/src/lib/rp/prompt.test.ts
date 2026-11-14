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

const prof = (o: Record<string, unknown> = {}) => JSON.stringify({ coreTraits: ["bubbly", "airheaded"], wouldNever: ["abandon a lost child"], ...o });
const tail = (r: ReturnType<typeof assembleMessages>) => r.messages.at(-1)!.content;

test("uses displayName in the system prompt, not the card title", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ name: "Alice in Wonderland | Lost Elf", displayName: "Alice", description: "", personality: "" }), persona, chat: chat(), history: turns(2) });
  assert.match(r.messages[0].content, /You are Alice\./);
  assert.ok(!all(r).includes("Alice in Wonderland | Lost Elf"));
});

test("voice reminder falls back to the profile when personality is empty", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ personality: "", profile: prof() }), persona, chat: chat(), history: turns(2) });
  assert.match(tail(r), /bubbly/);
});

test("profile slice is injected post-history, not in the system prompt", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ profile: prof() }), persona, chat: chat(), history: turns(2) });
  assert.match(tail(r), /abandon a lost child/);
  assert.ok(!r.messages[0].content.includes("abandon a lost child"));
});

test("profile format is restated verbatim in the voice reminder", () => {
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ profile: prof({ format: "X's Thoughts: **…**" }) }), persona, chat: chat(), history: turns(2) });
  assert.ok(tail(r).includes("X's Thoughts: **…**"));
});

test("agency and spice go through precedence; spice clamps to the profile range", () => {
  const p = prof({ defaults: { agency: 4, spice: { min: 0, max: 1 } } });
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ profile: p }), persona, chat: chat({ replySpice: 4 }), history: turns(2) });
  assert.match(tail(r), /fiercely guards their boundaries/);
  assert.match(tail(r), /suggestive rather than graphic/);
  assert.ok(!tail(r).includes("Hold nothing back"));
});

test("a mod that conflicts with the card adds a stay-true note", () => {
  const p = prof({ conflicts: ["bimbofication"] });
  const mods = JSON.stringify({ bimbofication: { enabled: true, value: 2 } });
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ profile: p }), persona, chat: chat({ mods }), history: turns(2) });
  assert.match(tail(r), /Note: the Bimbofication mod conflicts with this character's card/i);
  const quiet = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ profile: p }), persona, chat: chat(), history: turns(2) });
  assert.ok(!tail(quiet).includes("conflicts with this character's card"));
});

test("ensemble cast: example lines are labelled by speaker", () => {
  const p = prof({ cast: [{ name: "Rin", role: "older sister" }, { name: "Mio", role: "younger sister" }] });
  const r = assembleMessages({ settings: DEFAULT_RP_SETTINGS, character: char({ name: "Sisters", exampleDialogue: "Rin: hi\nMio: yo\n{{user}}: hey\nRin: bye", profile: p }), persona, chat: chat(), history: turns(2) });
  const ex = r.messages.filter((m) => /^(Rin|Mio): /.test(m.content));
  assert.deepEqual(ex.map((m) => [m.role, m.content]), [["assistant", "Rin: hi"], ["assistant", "Mio: yo"], ["assistant", "Rin: bye"]]);
  assert.ok(r.messages.some((m) => m.role === "user" && m.content === "hey"));
});

test("splitBySpeaker splits ensemble example text by cast name", async () => {
  const { splitBySpeaker } = await import("./exampleDialogue");
  assert.deepEqual(splitBySpeaker("Rin: hi\nMio: yo\nRin: bye", ["Rin", "Mio"]), [
    { speaker: "Rin", text: "hi" }, { speaker: "Mio", text: "yo" }, { speaker: "Rin", text: "bye" },
  ]);
});
