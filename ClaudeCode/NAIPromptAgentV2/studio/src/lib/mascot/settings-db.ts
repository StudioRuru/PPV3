import "server-only";
import { getSetting, setSetting } from "@/lib/db";
import { mergeMascotSettings, parseMascotSettings, type MascotSettings } from "./settings";

const KEY = "mascot:settings";

export const getMascotSettings = (): MascotSettings => parseMascotSettings(getSetting(KEY));

export function saveMascotSettings(patch: unknown): MascotSettings {
  const next = mergeMascotSettings(getMascotSettings(), patch);
  setSetting(KEY, JSON.stringify(next)); // Infinity serialises as null
  return next;
}
