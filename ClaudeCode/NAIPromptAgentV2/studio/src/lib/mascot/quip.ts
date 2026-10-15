import "server-only";
import { db, getSetting } from "@/lib/db";
import { BRAIN_MODEL } from "@/lib/env";
import { getDrift, learnedBlock, learnedStoryBlock } from "@/lib/learning";
import { chatStream, heavyGate } from "@/lib/llm";
import { installedModels } from "@/lib/rp/server";
import { tierModel } from "@/lib/tiers";
import { makeQuip } from "./quip-run";
import { getMascotSettings } from "./settings-db";
import { MascotStore } from "./store";

export const mascotStore = new MascotStore(db);

/** One line from Miyabi for an event; never throws (canned fallback), always journaled. */
export const quip = makeQuip({
  heavyInUse: () => heavyGate.state === "heavy" || heavyGate.busy,
  model: () => tierModel("quick", getSetting, BRAIN_MODEL),
  installed: installedModels,
  context: () => ({ mods: getMascotSettings().mods, drift: getDrift("miyabi"), taste: learnedBlock(), story: learnedStoryBlock() }),
  store: mascotStore,
  ask: async (system, user, model, options) => {
    let s = "";
    for await (const c of chatStream(system, [{ role: "user", content: user }], { model, options })) s += c;
    return s;
  },
});
