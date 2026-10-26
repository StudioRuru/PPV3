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

const join = (...p: string[]) => p.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean).join(", ");

/** charTags are left out so the LoRA learns the look itself from the trigger word. */
export const captionFor = (s: MascotSettings, outfit: Outfit, expr: Expression, shot: string, angle: string) =>
  `miyabi_sprite, ${join(outfitPrompt(s, outfit), s.exprTags[expr], shot, angle)}`;
/** Everything she wears in an outfit, in caption order, so pose prompts name what the LoRA learned. */
export const outfitPrompt = (s: MascotSettings, outfit: string) => join(s.constantTags, s.layerTags[outfit as Outfit] ?? "");

export function trainsetRenders(s: MascotSettings, start: number, n: number): TrainRender[] {
  return Array.from({ length: n }, (_, k) => {
    const i = start + k, outfit = OUTFITS[i % 3], expr = EXPRESSIONS[i % 9], shot = SHOTS[Math.floor(i / 3) % 4], angle = ANGLES[Math.floor(i / 12) % 4];
    return { i, outfit, tags: join(s.charTags, s.constantTags, s.layerTags[outfit], s.exprTags[expr], shot, angle, "simple background, white background"), caption: captionFor(s, outfit, expr, shot, angle) };
  });
}

export const nextIndex = (files: string[]) => files.reduce((m, f) => (/^\d+\.png$/.test(f) ? Math.max(m, parseInt(f, 10) + 1) : m), 0);
export const idx = (i: number) => String(i).padStart(3, "0");

const readJson = async <T>(f: string, d: T): Promise<T> => { try { return JSON.parse(await fsp.readFile(f, "utf8")) ?? d; } catch { return d; } };
export const readPicks = (dir = TRAINSET_DIR) => readJson<number[]>(path.join(dir, "picked.json"), []);
export const writePicks = (picks: number[], dir = TRAINSET_DIR) => fsp.writeFile(path.join(dir, "picked.json"), JSON.stringify(picks));
const readCost = (dir: string) => readJson<{ spent: number; per?: number }>(path.join(dir, "spent.json"), { spent: 0 });
export const readSpent = async (dir = TRAINSET_DIR) => (await readCost(dir)).spent;
export const readPer = async (dir = TRAINSET_DIR) => (await readCost(dir)).per ?? null;
/** A null cost (balance lookup failed) is never counted or trusted as a price; 0 is a real price (free on the plan). */
export async function addSpent(cost: number | null, dir = TRAINSET_DIR) {
  if (cost == null) return;
  const c = await readCost(dir);
  await fsp.writeFile(path.join(dir, "spent.json"), JSON.stringify({ spent: c.spent + cost, per: cost }));
}

/** Why a render request must be refused, or null. Batches need a verified price; the set caps at 100. */
export async function renderRefusal(n: number, existing: number, dir = TRAINSET_DIR): Promise<{ error: string; status: number } | null> {
  if (existing + n > 100) return { error: "The set is capped at 100 renders.", status: 400 };
  if (n > 1 && (await readPer(dir)) == null) return { error: "Render 1 first to check the price", status: 409 };
  return null;
}

/** The picked renders + their captions, ready for startTrain. Throws the range message before anything is read. */
export async function picksPayload(dir = TRAINSET_DIR): Promise<{ images: Buffer[]; captions: string[] }> {
  const picks = [...new Set(await readPicks(dir))].sort((a, b) => a - b);
  if (picks.length < MIN_IMAGES || picks.length > MAX_IMAGES) throw new Error(`Pick ${MIN_IMAGES}–${MAX_IMAGES} photos.`);
  return {
    images: await Promise.all(picks.map((i) => fsp.readFile(path.join(dir, `${idx(i)}.png`)))),
    captions: await Promise.all(picks.map(async (i) => (await fsp.readFile(path.join(dir, `${idx(i)}.txt`), "utf8")).trim())),
  };
}
