import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { blankSlime, type Sliders } from "./slime";
import { SlimeStore, migrateSlimes, type LiveIdentity, type LiveState } from "./slime-store";
import { VialStore, migrateVials } from "./vial-store";
import { DbIdentity } from "./identity";
import { MascotStore, migrateMascot } from "./store";
import { NEUTRAL_VIAL, UNDO_VIAL, type AppliedVial, type Vial } from "./vial";
import { vialAction, type VialDeps } from "./vial-api";

const live0 = (): LiveState => {
  const b = blankSlime();
  return { voice: "You are smug.", selfName: "Miyabi", mods: {}, heatDrift: false, look: b.look, sliders: { ...b.sliders, brat: { value: 6, cap: 8, live: 7 } }, memories: { facts: [], journal: [] }, vials: [] };
};
class FakeLive implements LiveIdentity {
  state: LiveState = live0();
  writes = 0;
  read() { return structuredClone(this.state); }
  write(s: LiveState | null) { this.writes++; if (s) this.state = structuredClone(s); }
  setPotions(sliders: Sliders, vials: AppliedVial[]) { this.writes++; this.state = { ...this.state, sliders: structuredClone(sliders), vials: structuredClone(vials) }; }
}

const brew = (name = "Brat Brew", value = 2): Vial => ({ name, color: "#ff0000", effect: `${name} makes you sassier`, sliders: { brat: { value } } });

function mk() {
  const db = new Database(":memory:");
  migrateSlimes(db);
  migrateVials(db);
  const live = new FakeLive();
  const store = new SlimeStore(db, live);
  const active = store.ensureFirstRun()!;
  const other = store.create({ ...blankSlime(), name: "Other", color: "#000000" });
  const vials = new VialStore(db);
  const quips: Record<string, unknown>[] = [];
  const d: VialDeps = { db, store, live, vials, quip: async (data) => { quips.push(data); return { expression: "flirty", text: "mm~" }; } };
  live.writes = 0;
  return { d, db, store, live, vials, active, other, quips };
}
type Body = { error?: string; id?: number; ids?: number[]; vial?: Vial; quip?: unknown; bottles: ({ id: number } & Vial)[]; recipes: { id: number; name: string; brewed: number }[]; jars: { id: number; active: boolean; vials: AppliedVial[]; doses: number; poison: number }[] };
const act = async (d: VialDeps, body: unknown) => { const r = await vialAction(body, d); return { status: r.status, b: r.body as Body }; };
const bottle = async (d: VialDeps, v: Vial = brew()) => (await act(d, { action: "bottle", vial: v })).b.id!;

test("listing: bottles, recipes, undo/neutral vials, jars with doses/poison", async () => {
  const { d, active } = mk();
  const id = await bottle(d);
  const { status, b } = await act(d, { action: "list" });
  assert.equal(status, 200);
  assert.deepEqual(b.bottles, [{ id, ...brew() }]);
  assert.deepEqual(b.recipes.map((r) => [r.name, r.brewed]), [["Brat Brew", 1]]);
  assert.deepEqual((b as unknown as { undo: Vial; neutral: Vial }).undo, UNDO_VIAL);
  assert.deepEqual((b as unknown as { undo: Vial; neutral: Vial }).neutral, NEUTRAL_VIAL);
  assert.deepEqual(b.jars.map((j) => [j.id === active, j.active, j.doses, j.poison]), [[true, true, 0, 0], [false, false, 0, 0]]);
});

test("bottle validates; parse reads Aru's block or explains", async () => {
  const { d } = mk();
  const bad = await act(d, { action: "bottle", vial: { name: "x", color: "red", effect: "e" } });
  assert.equal(bad.status, 400);
  assert.match(bad.b.error!, /color/);
  const ok = await act(d, { action: "parse", text: "here~\n```vial\n" + JSON.stringify(brew()) + "\n```" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.b.vial, brew());
  assert.equal((await act(d, { action: "parse", text: "no block" })).status, 400);
  assert.match((await act(d, { action: "parse", text: "```vial\n{oops\n```" })).b.error!, /JSON/);
  assert.equal((await act(d, { action: "parse", text: "x".repeat(30000) + "```vial\n" + JSON.stringify(brew()) + "\n```" })).status, 400, "input capped at 20k");
});

test("stacking the same vial into the active jar adds doses; jar doc and live both updated; quip fires", async () => {
  const { d, store, live, active, quips } = mk();
  const a = await bottle(d), b = await bottle(d);
  const r1 = await act(d, { action: "drop", id: a, jarId: active });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.b.quip, { expression: "flirty", text: "mm~" });
  await act(d, { action: "drop", id: b, jarId: active });
  assert.equal(live.state.vials.length, 1);
  assert.equal(live.state.vials[0].doses.length, 2);
  assert.deepEqual(live.state.sliders.brat, { value: 10, cap: 10 }, "applied to the live state (6/8) twice");
  assert.deepEqual(store.get(active)!.vials, live.state.vials);
  assert.deepEqual(store.get(active)!.sliders.brat, live.state.sliders.brat);
  assert.deepEqual(quips[0], { action: "drop", name: "Brat Brew", effect: "Brat Brew makes you sassier" });
  const j = (await act(d, { action: "list" })).b.jars.find((x) => x.id === active)!;
  assert.equal(j.doses, 2);
  assert.equal((await act(d, { action: "list" })).b.bottles.length, 0, "bottles consumed");
});

test("drop into an inactive jar never touches live and makes no quip", async () => {
  const { d, store, live, other, quips } = mk();
  const before = live.read();
  const r = await act(d, { action: "drop", id: await bottle(d), jarId: other });
  assert.equal(r.status, 200);
  assert.equal(r.b.quip, undefined);
  assert.equal(live.writes, 0);
  assert.deepEqual(live.read(), before);
  assert.equal(store.get(other)!.sliders.brat.value, 2);
  assert.equal(quips.length, 0);
});

test("undo through the API removes only the last dose; neutral restores sliders exactly", async () => {
  const { d, store, live, active, quips } = mk();
  const start = live.read().sliders;
  for (const v of [brew(), brew(), brew("Calm", -3), brew()]) await act(d, { action: "drop", id: await bottle(d, v), jarId: active });
  const r = await act(d, { action: "undo", jarId: active });
  assert.equal(r.status, 200);
  assert.deepEqual(live.state.vials.map((v) => [v.name, v.doses.length]), [["Brat Brew", 2], ["Calm", 1]]);
  assert.deepEqual(quips.at(-1), { action: "undo", removed: "Brat Brew" });
  const n = await act(d, { action: "neutral", jarId: active });
  assert.equal(n.status, 200);
  assert.deepEqual(live.state.vials, []);
  const back: Sliders = { ...start, brat: { value: 6, cap: 8 } }; // dosed sliders lose live drift
  assert.deepEqual(live.state.sliders, back);
  assert.deepEqual(store.get(active)!.sliders, back);
  assert.equal((await act(d, { action: "undo", jarId: active })).status, 400, "nothing to undo");
});

test("apply failure (9th distinct vial) rolls the take back: bottle stays in the inventory", async () => {
  const { d, store, other } = mk();
  for (let i = 0; i < 8; i++) await act(d, { action: "drop", id: await bottle(d, brew(`V${i}`, 1)), jarId: other });
  const ninth = await bottle(d, brew("V9", 1));
  const r = await act(d, { action: "drop", id: ninth, jarId: other });
  assert.equal(r.status, 400);
  assert.match(r.b.error!, /8 different potions/);
  assert.deepEqual(r.b.bottles?.map((x) => x.id) ?? (await act(d, { action: "list" })).b.bottles.map((x) => x.id), [ninth]);
  assert.equal(store.get(other)!.vials.length, 8);
});

test("double drop of the same bottle: second is 404, no double dose", async () => {
  const { d, live, active } = mk();
  const id = await bottle(d);
  const [a, b] = await Promise.all([act(d, { action: "drop", id, jarId: active }), act(d, { action: "drop", id, jarId: active })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 404]);
  assert.match((a.status === 404 ? a : b).b.error!, /^That bottle is gone\.$/);
  assert.equal(live.state.vials[0].doses.length, 1);
});

test("brew from a recipe makes bottles; forget removes the recipe; discard removes a bottle", async () => {
  const { d } = mk();
  const first = await bottle(d);
  const recipeId = (await act(d, { action: "list" })).b.recipes[0].id;
  const r = await act(d, { action: "brew", recipeId, count: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.b.ids!.length, 3);
  assert.equal(r.b.bottles.length, 4);
  assert.equal(r.b.recipes[0].brewed, 4);
  assert.equal((await act(d, { action: "discard", id: first })).b.bottles.length, 3);
  assert.equal((await act(d, { action: "forget", recipeId })).b.recipes.length, 0);
});

test("unknown action / bad ids / bad count / unknown jar or recipe → 400", async () => {
  const { d, active } = mk();
  const id = await bottle(d);
  for (const body of [null, {}, { action: "nope" }, { action: "drop", id: "1", jarId: active }, { action: "drop", id, jarId: 999 }, { action: "drop", id, jarId: 1.5 },
    { action: "brew", recipeId: 1, count: 6 }, { action: "brew", recipeId: 999, count: 1 }, { action: "discard", id: "x" }, { action: "undo", jarId: "a" }, { action: "neutral" }, { action: "parse", text: 5 }]) {
    const r = await act(d, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.b.error, "string");
  }
  assert.equal((await act(d, { action: "list" })).b.bottles.length, 1, "failed drop into missing jar kept the bottle");
});

test("Empty (no active jar): dropping into any jar works, no quip, live untouched", async () => {
  const { d, store, live, active, quips } = mk();
  store.remove();
  live.writes = 0;
  const r = await act(d, { action: "drop", id: await bottle(d), jarId: active });
  assert.equal(r.status, 200);
  assert.equal(live.writes, 0);
  assert.equal(quips.length, 0);
  assert.equal(store.get(active)!.vials.length, 1);
});

test("potion actions on the active jar never rewrite memories (journal, fact ids, refresh marker)", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  migrateMascot(db); migrateSlimes(db); migrateVials(db);
  let t = 0;
  const ms = new MascotStore(db, () => ++t);
  for (let i = 0; i < 80; i++) ms.log("tap", `s${i}`, `l${i}`);
  ms.setFacts(["likes cats", "hates mornings"]);
  ms.markRefreshed();
  const live = new DbIdentity(db, ms);
  const store = new SlimeStore(db, live);
  const active = store.ensureFirstRun()!;
  const d: VialDeps = { db, store, live, vials: new VialStore(db), quip: async () => ({ expression: "flirty", text: "mm~" }) };
  const snap = () => ({
    journal: db.prepare("SELECT id, line FROM mascot_journal ORDER BY id").all(),
    facts: db.prepare("SELECT id, text FROM mascot_facts ORDER BY id").all(),
    meta: db.prepare("SELECT key, value FROM mascot_meta WHERE key <> 'active_slime' ORDER BY key").all(),
  });
  const before = snap();
  assert.equal(before.journal.length, 80);
  const brat0 = live.read().sliders.brat;
  for (const id of [await bottle(d), await bottle(d)]) assert.equal((await act(d, { action: "drop", id, jarId: active })).status, 200);
  assert.equal(live.read().vials[0].doses.length, 2);
  assert.deepEqual(store.get(active)!.vials, live.read().vials);
  assert.equal((await act(d, { action: "undo", jarId: active })).status, 200);
  assert.equal(live.read().vials[0].doses.length, 1);
  assert.equal((await act(d, { action: "neutral", jarId: active })).status, 200);
  assert.deepEqual(live.read().vials, []);
  assert.deepEqual({ value: live.read().sliders.brat.value, cap: live.read().sliders.brat.cap }, { value: brat0.value, cap: brat0.cap });
  assert.deepEqual(snap(), before);
});

test("live potion write failing on the active jar rolls everything back: bottle kept, jar unchanged, 500", async () => {
  const { d, store, live, active } = mk();
  const id = await bottle(d);
  const jar = store.get(active);
  live.setPotions = () => { throw new Error("disk on fire"); };
  const r = await act(d, { action: "drop", id, jarId: active });
  assert.equal(r.status, 500);
  assert.deepEqual((await act(d, { action: "list" })).b.bottles.map((x) => x.id), [id]);
  assert.deepEqual(store.get(active), jar);
});
