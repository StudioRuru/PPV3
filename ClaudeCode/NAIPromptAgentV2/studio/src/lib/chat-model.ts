import { slimePersona, type Identity } from "./mascot/identity";
import { personaBlock, type Modifiers, type PersonaId } from "./persona";
import { tierModel } from "./tiers";

/** Chat model per thread persona: Miyabi's deep talk runs on the heavy tier; undefined = the everyday brain. */
export function modelFor(persona: PersonaId, get: (key: string) => string | null, brain: string): string | undefined {
  return persona === "miyabi" ? tierModel("heavy", get, brain) : undefined;
}

/** Persona block (+ Ollama options) for a thread: Miyabi speaks as the active slime, with num_predict from its length slider. */
export function chatPersona(persona: PersonaId, mods: Modifiers, drift: number, identity: () => Identity): { block: string; options?: Record<string, unknown> } {
  if (persona !== "miyabi") return { block: personaBlock(persona, mods, drift) };
  const i = identity();
  return { block: slimePersona(i, true), options: { num_predict: Math.max(i.lengthShape.talkPredict, 800) } }; // room for co-pilot patch cards
}
