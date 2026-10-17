// Client-safe: imported by components.
import { type PhotoRecipe, type VideoRecipe, wanFrames } from "./recipe";

type Kind = "photo" | "i2v" | "t2v";
type Cls = "48gb" | "h100";
// ponytail: placeholder numbers (seconds per step at 1 MP / 81 frames, plus load overhead); Task 13 replaces them with measured ones
const PER_STEP: Record<Kind, Record<Cls, Record<string, number>>> = {
  photo: { "48gb": { "1mp": 0.25 }, h100: { "1mp": 0.12 } },
  i2v: { "48gb": { "480p": 9, "720p": 26 }, h100: { "480p": 4.5, "720p": 12 } },
  t2v: { "48gb": { "480p": 3, "720p": 8 }, h100: { "480p": 1.5, "720p": 4 } },
};
const OVERHEAD: Record<Kind, number> = { photo: 5, i2v: 60, t2v: 40 };

export function estimate(r: PhotoRecipe | VideoRecipe, gpu: string, usdHr: number): { seconds: number; usd: number } {
  const cls: Cls = /H100/i.test(gpu) ? "h100" : "48gb";
  let seconds: number;
  if (r.mode === "photo") {
    const mp = (r.width * r.height) / 1024 ** 2;
    const hires = r.hires ? 1 + r.hires.scale ** 2 * r.hires.denoise : 1;
    seconds = OVERHEAD.photo + r.steps * PER_STEP.photo[cls]["1mp"] * mp * hires;
  } else {
    const kind: Kind = r.mode === "t2v" ? "t2v" : "i2v";
    seconds = OVERHEAD[kind] + r.steps * PER_STEP[kind][cls][r.size] * (wanFrames(r.seconds) / 81);
  }
  seconds = Math.round(seconds);
  return { seconds, usd: (seconds / 3600) * usdHr };
}
