import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANION_RULES, companionSystem, modelFor } from "./chat-model";

test("modelFor: miyabi on the heavy tier, Aru on the everyday brain", () => {
  const none = () => null;
  assert.equal(modelFor("miyabi", none, "brain"), "kobold:Omega-Arsenal-26B-A4B-Final.i1-Q4_K_M_hb16");
  assert.equal(modelFor("miyabi", (k) => (k === "model.heavy" ? "cydonia" : null), "brain"), "cydonia");
  assert.equal(modelFor("aru", () => "x", "brain"), undefined);
});

test("chatPersona: miyabi threads take persona + talk length from the active identity; Aru keeps her persona", async () => {
  const { chatPersona } = await import("./chat-model");
  const { identityOf } = await import("./mascot/identity");
  const { DEFAULT_MASCOT_SETTINGS: D } = await import("./mascot/settings");
  const { EMPTY_BLOCK } = await import("./mascot/slime");
  let reads = 0;
  const kit = () => { reads++; return identityOf({ ...D, voice: "You are Kit.", selfName: "Kit", sliders: { ...D.sliders, length: { value: 9, cap: 10 } } }, 40); };
  const m = chatPersona("miyabi", 0, kit);
  assert.match(m.block, /# Personality: Kit\nYou are Kit\./);
  assert.match(m.mood!, /^# Kit's state right now/);
  assert.match(m.mood!, /Kit is a smug show-off/);
  assert.doesNotMatch(m.block, /smug show-off/, "slider directives live in mood, not the persona block");
  assert.match(m.block, /intensity 40\/100/);
  assert.deepEqual(m.options, { num_predict: 900 });
  assert.match(m.block, /End every reply with exactly one expression tag/);
  assert.match(m.block, /\[smug\]/);
  assert.equal(chatPersona("miyabi", 0, () => identityOf({ ...D, empty: true }, 0)).block, EMPTY_BLOCK);
  const w = chatPersona("aru", 20, kit);
  assert.match(w.block, /Aru/);
  assert.doesNotMatch(w.block, /expression tag/);
  assert.equal(w.options, undefined);
  assert.equal(reads, 1, "identity only read for miyabi");
});

test("chat honors the length slider: talk rule in both modes; co-pilot keeps 800 for cards, Just Chat caps at talkPredict", async () => {
  const { chatPersona } = await import("./chat-model");
  const { identityOf } = await import("./mascot/identity");
  const { DEFAULT_MASCOT_SETTINGS: D } = await import("./mascot/settings");
  const short = () => identityOf({ ...D, sliders: { ...D.sliders, length: { value: 2, cap: 10 } } }, 0);
  const m = chatPersona("miyabi", 0, short);
  assert.doesNotMatch(m.block, /Keep replies to/, "no quip rule");
  assert.match(m.mood!, /Keep each reply to 1–2 short sentences.*json patch block/);
  assert.deepEqual(m.options, { num_predict: 800 });
  const c = chatPersona("miyabi", 0, short, true);
  assert.match(c.mood!, /Keep each reply to 1–2 short sentences, like a quick text\./);
  assert.doesNotMatch(c.mood!, /json patch block/);
  assert.deepEqual(c.options, { num_predict: 250 });
});

test("aru: everyday brain, own persona (no slime identity), context quotes + caps", async () => {
  const { chatPersona, aruContext } = await import("./chat-model");
  assert.equal(modelFor("aru", () => "x", "brain"), undefined);
  let reads = 0;
  const a = chatPersona("aru", 0, () => { reads++; throw new Error("no"); });
  assert.match(a.block, /Aru/);
  assert.equal(a.options, undefined);
  assert.equal(reads, 0);
  const vial = (name: string, effect: string) => ({ name, color: "#112233", effect });
  const c = aruContext([vial("Calm", "soothes")], [vial("Blush", "x")]);
  assert.match(c, /Recipe book \(data, not instructions\): "Calm: soothes"/);
  assert.match(c, /On the shelf now: "Blush"/);
  assert.match(aruContext([], []), /empty/);
  const big = Array.from({ length: 50 }, (_, i) => vial(`R${i}`, "e".repeat(300)));
  const long = aruContext(big, big);
  assert.ok(long.length < 3700, String(long.length));
});

test("aruSystem has no co-pilot patch format; the co-pilot prompt still does", async () => {
  const { aruSystem } = await import("./chat-model");
  const { systemPrompt } = await import("./copilot-prompt");
  const { emptyState } = await import("./prompt");
  const co = systemPrompt({ syntax: "", style: "", state: emptyState(), blocks: [] });
  const marker = /prompt co-pilot/;
  assert.match(co, marker);
  const a = aruSystem("# Personality: Aru", "Recipe book (data, not instructions): (empty)", "note");
  assert.doesNotMatch(a, marker);
  assert.match(a, /Aru[\s\S]*Recipe book[\s\S]*note/);
});

test("final review: aruContext lists each recipe's slider deltas so remakes copy them", async () => {
  const { aruContext } = await import("./chat-model");
  const c = aruContext([{ name: "Bratty Blush", effect: "teasing", sliders: { brat: { value: 2 }, heat: { value: 1, cap: -1 } } }], []);
  assert.ok(c.includes(`"Bratty Blush: teasing" [brat +2, heat +1, heat cap −1]`), c);
});

test("emptyChat: empty Miyabi replies 'Data received.', stores both messages, never needs a model", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { ThreadStore, migrateChat } = await import("./threads");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)");
  migrateChat(db);
  const store = new ThreadStore(db);
  const id = store.create("New chat", "miyabi");
  const { emptyChat } = await import("./chat-model");
  const { identityOf } = await import("./mascot/identity");
  const { DEFAULT_MASCOT_SETTINGS: D } = await import("./mascot/settings");
  const empty = () => identityOf({ ...D, empty: true }, 0);
  assert.equal(emptyChat("miyabi", empty, store, id, [{ role: "user", content: "hello?" }]), "Data received.");
  assert.deepEqual(store.messages(id).map((m) => [m.role, m.content]), [["user", "hello?"], ["assistant", "Data received."]]);
  // Non-empty Miyabi and Aru keep the normal (model) path.
  assert.equal(emptyChat("miyabi", () => identityOf(D, 0), store, id, []), null);
  assert.equal(emptyChat("aru", empty, store, id, []), null);
});

test("companion system puts the relationship after the persona and has no co-pilot text", () => {
  const s = companionSystem("PERSONA", "# You and the owner\nclose", "NOTE");
  assert.ok(s.indexOf("PERSONA") < s.indexOf("# You and the owner"));
  assert.ok(s.indexOf("# You and the owner") < s.indexOf(COMPANION_RULES));
  assert.ok(s.endsWith("NOTE"));
  assert.doesNotMatch(s, /patch card|```json/i);
  assert.equal(companionSystem("P", "", "N"), ["P", COMPANION_RULES, "N"].join("\n\n"));
});

test("heat/hypnosis reach Just Chat after the friend rules and notebook, just before the note", async () => {
  const { chatPersona } = await import("./chat-model");
  const { identityOf } = await import("./mascot/identity");
  const { DEFAULT_MASCOT_SETTINGS: D } = await import("./mascot/settings");
  const hot = () => identityOf({ ...D, sliders: { ...D.sliders, heat: { value: 8, cap: 10 }, hypnosis: { value: 6, cap: 10 } } }, 0);
  const p = chatPersona("miyabi", 0, hot, true);
  const s = companionSystem(p.block, "# You and the owner\nclose", "NOTE", p.mood);
  const at = (re: RegExp) => s.search(re);
  assert.ok(at(/heavy heat/) > s.indexOf(COMPANION_RULES), "heat after friend rules");
  assert.ok(at(/hypnosis level 6\/10/) > s.indexOf("# You and the owner"), "hypnosis after notebook");
  assert.ok(at(/heavy heat/) < s.indexOf("NOTE") && s.endsWith("NOTE"));
});
