// Vials API logic with injected deps (db wiring lives in app/api/mascot/vials/route.ts) so it can be unit-tested.
import type Database from "better-sqlite3";
import type { Expression } from "./core";
import type { SlimeDoc } from "./slime";
import type { LiveIdentity, SlimeStore } from "./slime-store";
import { applyVial, neutralize, NEUTRAL_VIAL, parseVialBlock, poisonLevel, undoLast, UNDO_VIAL, validateVial, type AppliedVial } from "./vial";
import type { VialStore } from "./vial-store";

export type VialDeps = {
  db: Database.Database;
  store: SlimeStore;
  live: LiveIdentity;
  vials: VialStore;
  /** A `vial_drop` reaction from the active slime; `data` says what was poured or drained. */
  quip: (data: Record<string, unknown>) => Promise<{ expression: Expression; text: string }>;
};
export type VialResult = { status: number; body: unknown };

const PARSE_MAX = 20_000;
/** Store refusals the owner can act on; anything else (DB trouble) is a 500. */
const KNOWN = /not found|Invalid slime doc|Invalid live identity|Invalid vial/;
class Fail extends Error { constructor(public status: number, msg: string) { super(msg); } }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const intOf = (v: unknown, what: string): number => { if (!Number.isInteger(v)) throw new Fail(400, `${what} is required.`); return v as number; };
const doses = (vials: AppliedVial[]) => vials.reduce((n, a) => n + a.doses.length, 0);

/** What the apothecary shows (also GET). The active jar's potions come from the live identity (authoritative). */
export function listing(d: VialDeps) {
  const active = d.store.activeId();
  const liveVials = active === null ? [] : d.live.read().vials;
  return {
    bottles: d.vials.list().map(({ id, vial }) => ({ id, ...vial })),
    recipes: d.vials.recipes().map(({ id, name, vial, brewed }) => ({ id, name, color: vial.color, effect: vial.effect, sliders: vial.sliders, brewed })),
    undo: UNDO_VIAL, neutral: NEUTRAL_VIAL,
    jars: d.store.list().map(({ id, doc }) => {
      const vials = id === active ? liveVials : (doc.vials as AppliedVial[]);
      return { id, name: doc.name, color: doc.color, active: id === active, vials, doses: doses(vials), poison: poisonLevel(vials) };
    }),
  };
}

/**
 * One transaction: (optionally take a bottle), change jar `jarId`, save it. Active jar: the change is applied to the
 * live state (its sliders may hold drift) and written to both jar doc and live identity. Any throw rolls everything back.
 */
function change(d: VialDeps, jarId: number, f: (doc: SlimeDoc) => SlimeDoc): { doc: SlimeDoc; active: boolean } {
  return d.db.transaction(() => {
    const jar = d.store.get(jarId);
    if (!jar) throw new Fail(400, `Slime ${jarId} not found.`);
    const state = d.store.activeId() === jarId ? d.live.read() : null;
    const next = f(state ? { ...jar, ...state } : jar);
    const doc = d.store.save(jarId, { sliders: next.sliders, vials: next.vials });
    if (state) d.live.write({ ...state, sliders: next.sliders, vials: next.vials }); // live write last
    return { doc, active: !!state };
  })();
}

async function safeQuip(d: VialDeps, data: Record<string, unknown>) {
  try { return await d.quip(data); } catch { return { expression: "sleepy" as Expression, text: "..." }; }
}

/** Name of the vial holding the newest dose. */
const lastDosed = (vials: AppliedVial[]) => vials.reduce<{ name: string; seq: number } | null>((best, a) =>
  a.doses.reduce((b, x) => (!b || x.seq > b.seq ? { name: a.name, seq: x.seq } : b), best), null)?.name;

async function run(b: Record<string, unknown>, d: VialDeps): Promise<Record<string, unknown>> {
  switch (b.action) {
    case "list": return {};
    case "bottle": {
      const r = validateVial(b.vial);
      if (!r.ok) throw new Fail(400, `Invalid vial: ${r.reason}`);
      return { id: d.vials.bottle(r.vial) };
    }
    case "parse": {
      if (typeof b.text !== "string") throw new Fail(400, "text is required.");
      const r = parseVialBlock(b.text.slice(0, PARSE_MAX));
      if (!r) throw new Fail(400, "No vial block found.");
      if ("error" in r) throw new Fail(400, `Invalid vial: ${r.error}`);
      return { vial: r };
    }
    case "discard": d.vials.discard(intOf(b.id, "A bottle id")); return {};
    case "brew": {
      const recipeId = intOf(b.recipeId, "A recipe id");
      const count = b.count === undefined ? 1 : b.count;
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 5) throw new Fail(400, "Brew 1–5 bottles.");
      return { ids: d.vials.brewAgain(recipeId, count as number) };
    }
    case "forget": d.vials.forgetRecipe(intOf(b.recipeId, "A recipe id")); return {};
    case "drop": {
      const id = intOf(b.id, "A bottle id"), jarId = intOf(b.jarId, "A jar id");
      let v = null as ReturnType<VialStore["take"]>;
      const r = change(d, jarId, (doc) => {
        v = d.vials.take(id);
        if (!v) throw new Fail(404, "That bottle is gone");
        const a = applyVial(doc, v);
        if ("error" in a) throw new Fail(400, a.error);
        return a.doc;
      });
      return { jar: r.doc, ...(r.active ? { quip: await safeQuip(d, { action: "drop", name: v!.name, effect: v!.effect }) } : {}) };
    }
    case "undo":
    case "neutral": {
      const jarId = intOf(b.jarId, "A jar id");
      let removed = "";
      const r = change(d, jarId, (doc) => {
        const vials = doc.vials as AppliedVial[];
        if (!vials.length) throw new Fail(400, "No potions in this jar.");
        removed = b.action === "undo" ? lastDosed(vials)! : vials.map((a) => a.name).join(", ");
        return b.action === "undo" ? undoLast(doc) : neutralize(doc);
      });
      return { jar: r.doc, ...(r.active ? { quip: await safeQuip(d, { action: b.action, removed }) } : {}) };
    }
    default: throw new Fail(400, "Unknown action.");
  }
}

/** POST body → { status, body }. Success bodies carry the fresh listing plus the action's extras (id, ids, vial, jar, quip). */
export async function vialAction(body: unknown, d: VialDeps): Promise<VialResult> {
  if (!isObj(body)) return { status: 400, body: { error: "Send a JSON body with an action." } };
  try {
    const extra = await run(body, d);
    return { status: 200, body: { ...listing(d), ...extra } };
  } catch (e) {
    if (e instanceof Fail) return { status: e.status, body: { error: e.message } };
    const msg = (e as Error).message ?? "";
    return KNOWN.test(msg) ? { status: 400, body: { error: msg } } : { status: 500, body: { error: "Something went wrong with the vials" } };
  }
}
