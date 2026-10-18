// Client-safe: imported by components.
import type { EditJob } from "../sprites/graph";
import { isQwen, type PhotoRecipe, type VideoRecipe, wanFrames } from "./recipe";

type Kind = "photo" | "i2v" | "t2v";
type Cls = "48gb" | "h100";
// Seconds per step at 1 MP / 81 frames, plus load overhead. Measured on an A6000 (T13): SDXL 28 steps 6 s, Qwen 25 steps 37 s,
// Smooth Mix 5 s 480p 8 steps 157–166 s incl. RIFE to 60 fps. ponytail: H100, 720p and t2v are scaled guesses, re-measure when used.
const PER_STEP: Record<Kind, Record<Cls, Record<string, number>>> = {
  photo: { "48gb": { "1mp": 0.15, qwen: 1.45 }, h100: { "1mp": 0.07, qwen: 0.7 } },
  i2v: { "48gb": { "480p": 13, "720p": 36 }, h100: { "480p": 6, "720p": 17 } },
  t2v: { "48gb": { "480p": 3, "720p": 8 }, h100: { "480p": 1.5, "720p": 4 } },
};
const OVERHEAD: Record<Kind, number> = { photo: 2, i2v: 60, t2v: 40 };

export function estimate(r: PhotoRecipe | VideoRecipe | EditJob, gpu: string, usdHr: number): { seconds: number; usd: number } {
  const cls: Cls = /H100/i.test(gpu) ? "h100" : "48gb";
  let seconds: number;
  if ("preset" in r) {
    const steps = r.preset === "turbo" ? 8 : 25;
    seconds = OVERHEAD.photo + steps * PER_STEP.photo[cls].qwen * ((r.width * r.height) / 1024 ** 2);
  } else if (r.mode === "photo") {
    const mp = (r.width * r.height) / 1024 ** 2;
    const hires = r.hires ? 1 + r.hires.scale ** 2 * r.hires.denoise : 1;
    seconds = OVERHEAD.photo + r.steps * PER_STEP.photo[cls][isQwen(r.model) ? "qwen" : "1mp"] * mp * hires;
  } else {
    const kind: Kind = r.mode === "t2v" ? "t2v" : "i2v";
    seconds = OVERHEAD[kind] + r.steps * PER_STEP[kind][cls][r.size] * (wanFrames(r.seconds) / 81);
  }
  seconds = Math.round(seconds);
  return { seconds, usd: (seconds / 3600) * usdHr };
}
