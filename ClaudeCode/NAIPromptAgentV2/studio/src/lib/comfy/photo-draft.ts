import { DEFAULT_PHOTO_NEGATIVE, type PhotoRecipe } from "./recipe";

export const PHOTO_DRAFT_KEY = "studio-comfy-photo-v1";

export function defaultPhoto(models: string[]): PhotoRecipe {
  return {
    mode: "photo", model: models[0] ?? "", prompt: "", negative: DEFAULT_PHOTO_NEGATIVE, loras: [], pose: null,
    seed: -1, steps: 28, cfg: 5.5, sampler: "euler_ancestral", scheduler: "normal", width: 832, height: 1216, hires: null,
  };
}

/** Per-device convenience only; storage can be blocked, so never throw. The pose is session-only (its image lives on the server). */
export function loadPhoto(): PhotoRecipe | null {
  try {
    const o = JSON.parse(localStorage.getItem(PHOTO_DRAFT_KEY) ?? "null");
    return o && typeof o === "object" && o.mode === "photo" ? { ...defaultPhoto([]), ...o, pose: null } : null;
  } catch { return null; }
}

export function savePhoto(r: PhotoRecipe): void {
  try { localStorage.setItem(PHOTO_DRAFT_KEY, JSON.stringify({ ...r, pose: null })); } catch {}
}
