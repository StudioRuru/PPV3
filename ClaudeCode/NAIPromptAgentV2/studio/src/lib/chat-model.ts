import type { PersonaId } from "./persona";
import { tierModel } from "./tiers";

/** Chat model per thread persona: Miyabi's deep talk runs on the heavy tier; undefined = the everyday brain. */
export function modelFor(persona: PersonaId, get: (key: string) => string | null, brain: string): string | undefined {
  return persona === "miyabi" ? tierModel("heavy", get, brain) : undefined;
}
