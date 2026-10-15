import "server-only";
import { db, getSetting } from "@/lib/db";
import { BRAIN_MODEL } from "@/lib/env";
import { getDrift, learnedBlock, learnedStoryBlock } from "@/lib/learning";
import { chatStream, heavyGate } from "@/lib/llm";
import { installedModels } from "@/lib/rp/server";
import { tierModel } from "@/lib/tiers";
import { DbIdentity } from "./identity";
import { makeQuip } from "./quip-run";
import { SlimeStore } from "./slime-store";
import { MascotStore } from "./store";

export const mascotStore = new MascotStore(db);
/** Live identity + slime jars on the app db (one handle, so jar switches are atomic). */
export const liveIdentity = new DbIdentity(db, mascotStore);
export const slimeStore = new SlimeStore(db, liveIdentity);
// Jar #1 "Miyabi" exists before any API call (not while `next build` imports routes).
if (process.env.NEXT_PHASE !== "phase-production-build") slimeStore.ensureFirstRun();
/** What quips and deep talk read: the active slime (or Empty). */
export const activeIdentity = () => liveIdentity.active(getDrift("miyabi"));

/** One line from Miyabi for an event; never throws (canned fallback), always journaled. */
export const quip = makeQuip({
  heavyInUse: () => heavyGate.state === "heavy" || heavyGate.busy,
  model: () => tierModel("quick", getSetting, BRAIN_MODEL),
  installed: installedModels,
  context: () => ({ identity: activeIdentity(), taste: learnedBlock(), story: learnedStoryBlock() }),
  drift: (e) => liveIdentity.drift(e),
  store: mascotStore,
  ask: async (system, user, model, options) => {
    let s = "";
    for await (const c of chatStream(system, [{ role: "user", content: user }], { model, options })) s += c;
    return s;
  },
});
