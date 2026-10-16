import "server-only";
import { getSetting, setSetting } from "@/lib/db";
import { MASCOT_DIR, spriteDirFor } from "./sprites";
import { ARU_SETTINGS_KEY, mergeAruSettings, parseAruSettings, profileLook, type AruSettings } from "./profiles";
import { MASCOT_SETTINGS_KEY as KEY, mergeMascotSettings, parseMascotSettings, type MascotSettings } from "./settings";

export const getMascotSettings = (): MascotSettings => parseMascotSettings(getSetting(KEY));

export function saveMascotSettings(patch: unknown): MascotSettings {
  const next = mergeMascotSettings(getMascotSettings(), patch);
  setSetting(KEY, JSON.stringify(next)); // Infinity serialises as null
  return next;
}

/** The active look's sprite folder (the whitelist already holds at merge; root as a last resort). */
export const activeSpriteDir = (): string => spriteDirFor(getMascotSettings().spriteDir) ?? MASCOT_DIR;

export const getAruSettings = (): AruSettings => parseAruSettings(getSetting(ARU_SETTINGS_KEY));

export function saveAruSettings(patch: unknown): AruSettings {
  const next = mergeAruSettings(getAruSettings(), patch);
  setSetting(ARU_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** A profile's sprite folder: `?profile=` value ("aru" → data/mascot/aru), anything else = the active look. */
export const profileSpriteDir = (profile: string | null): string =>
  profile === "aru" ? spriteDirFor(profileLook("aru", getMascotSettings(), getAruSettings()).spriteDir)! : activeSpriteDir();
