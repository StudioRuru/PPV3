import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, getSetting, setSetting } from "@/lib/db";
import { BRAIN_MODEL, DATA_DIR, OLLAMA_URL } from "@/lib/env";
import { tierModel } from "@/lib/tiers";
import { RpStore } from "./store";
import { DEFAULT_RP_SETTINGS, type RpSettings } from "./types";

export const RP_DIR = path.join(DATA_DIR, "rp");
export const rp = new RpStore(db);

export function rpSettings(): RpSettings {
  try { return { ...DEFAULT_RP_SETTINGS, ...JSON.parse(getSetting("rp:settings") ?? "{}") }; } catch { return DEFAULT_RP_SETTINGS; }
}
export function saveRpSettings(patch: Partial<RpSettings>): RpSettings {
  const known = Object.fromEntries(Object.entries(patch).filter(([k, v]) => k in DEFAULT_RP_SETTINGS && typeof v === typeof DEFAULT_RP_SETTINGS[k as keyof RpSettings]));
  const next = { ...rpSettings(), ...known };
  setSetting("rp:settings", JSON.stringify(next));
  return next;
}

export const heavyModel = () => tierModel("heavy", getSetting, BRAIN_MODEL);

let tags: { at: number; names: string[] } = { at: 0, names: [] };
/** Installed Ollama models (cached 60 s). */
export async function installedModels(): Promise<string[]> {
  if (Date.now() - tags.at < 60_000) return tags.names;
  const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json(), () => null);
  tags = { at: Date.now(), names: (r?.models ?? []).map((m: { name: string }) => m.name) };
  return tags.names;
}

/** Store bytes as a new RP avatar/image; returns its bare file name. */
export function saveRpFile(kind: "avatars" | "images", bytes: Buffer, ext: string): string {
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.mkdirSync(path.join(RP_DIR, kind), { recursive: true });
  fs.writeFileSync(path.join(RP_DIR, kind, name), bytes);
  return name;
}

/** Remove files no row refers to any more. */
export function removeRpFiles(names: string[]): void {
  for (const n of names) {
    const usedAvatar = db.prepare("SELECT 1 FROM rp_characters WHERE avatar_path = ? UNION SELECT 1 FROM rp_personas WHERE avatar_path = ?").get(n, n);
    const usedImage = db.prepare("SELECT 1 FROM rp_images WHERE file = ?").get(n);
    for (const kind of ["avatars", "images"]) {
      if ((kind === "avatars" && usedAvatar) || (kind === "images" && usedImage)) continue;
      if (/^[\w-]+\.(png|jpe?g|webp)$/i.test(n)) fs.rmSync(path.join(RP_DIR, kind, n), { force: true });
    }
  }
}
