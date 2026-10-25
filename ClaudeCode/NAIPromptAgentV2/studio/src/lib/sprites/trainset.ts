import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../env";
import { MAX_IMAGES, MIN_IMAGES } from "../comfy/train";
import { EXPRESSIONS, OUTFITS, type Expression, type Outfit } from "../mascot/core";
import type { MascotSettings } from "../mascot/settings";

export const SHOTS = ["portrait", "upper body", "cowboy shot", "full body"];
export const ANGLES = ["straight-on", "from side", "three quarter view", "from above"];
export const TRAINSET_DIR = path.join(DATA_DIR, "trainset", "miyabi");

export type TrainRender = { i: number; outfit: Outfit; tags: string; caption: string };

const join = (...p: string[]) => p.map((x) => x.trim()).filter(Boolean).join(", ");

/** charTags are left out so the LoRA learns the look itself from the trigger word. */
export const captionFor = (s: MascotSettings, outfit: Outfit, expr: Expression, shot: string, angle: string) =>
  `miyabi_sprite, ${join(s.constantTags, s.layerTags[outfit], s.exprTags[expr], shot, angle)}`;

export function trainsetRenders(s: MascotSettings, start: number, n: number): TrainRender[] {
  return Array.from({ length: n }, (_, k) => {
    const i = start + k, outfit = OUTFITS[i % 3], expr = EXPRESSIONS[i % 9], shot = SHOTS[Math.floor(i / 3) % 4], angle = ANGLES[Math.floor(i / 12) % 4];
    return { i, outfit, tags: join(s.charTags, s.constantTags, s.layerTags[outfit], s.exprTags[expr], shot, angle, "simple background, white background"), caption: captionFor(s, outfit, expr, shot, angle) };
  });
}

export const nextIndex = (files: string[]) => files.reduce((m, f) => (/^\d+\.png$/.test(f) ? Math.max(m, parseInt(f, 10) + 1) : m), 0);
export const idx = (i: number) => String(i).padStart(3, "0");

const readJson = async <T>(f: string, d: T): Promise<T> => JSON.parse(await fsp.readFile(f, "utf8").catch(() => "null")) ?? d;
export const readPicks = (dir = TRAINSET_DIR) => readJson<number[]>(path.join(dir, "picked.json"), []);
export const writePicks = (picks: number[], dir = TRAINSET_DIR) => fsp.writeFile(path.join(dir, "picked.json"), JSON.stringify(picks));
export const readSpent = async (dir = TRAINSET_DIR) => (await readJson<{ spent: number }>(path.join(dir, "spent.json"), { spent: 0 })).spent;
export const addSpent = async (n: number, dir = TRAINSET_DIR) => fsp.writeFile(path.join(dir, "spent.json"), JSON.stringify({ spent: (await readSpent(dir)) + n }));

/** The picked renders + their captions, ready for startTrain. Throws the range message before anything is read. */
export async function picksPayload(dir = TRAINSET_DIR): Promise<{ images: Buffer[]; captions: string[] }> {
  const picks = [...new Set(await readPicks(dir))].sort((a, b) => a - b);
  if (picks.length < MIN_IMAGES || picks.length > MAX_IMAGES) throw new Error(`Pick ${MIN_IMAGES}–${MAX_IMAGES} photos.`);
  return {
    images: await Promise.all(picks.map((i) => fsp.readFile(path.join(dir, `${idx(i)}.png`)))),
    captions: await Promise.all(picks.map(async (i) => (await fsp.readFile(path.join(dir, `${idx(i)}.txt`), "utf8")).trim())),
  };
}
