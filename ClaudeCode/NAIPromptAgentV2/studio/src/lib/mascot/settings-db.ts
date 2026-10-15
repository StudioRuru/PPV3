import "server-only";
import { getSetting, setSetting } from "@/lib/db";
import { MASCOT_DIR, spriteDirFor } from "./sprites";
import { MASCOT_SETTINGS_KEY as KEY, mergeMascotSettings, parseMascotSettings, type MascotSettings } from "./settings";

export const getMascotSettings = (): MascotSettings => parseMascotSettings(getSetting(KEY));

export function saveMascotSettings(patch: unknown): MascotSettings {
  const next = mergeMascotSettings(getMascotSettings(), patch);
  setSetting(KEY, JSON.stringify(next)); // Infinity serialises as null
  return next;
}

/** The active look's sprite folder (the whitelist already holds at merge; root as a last resort). */
export const activeSpriteDir = (): string => spriteDirFor(getMascotSettings().spriteDir) ?? MASCOT_DIR;
