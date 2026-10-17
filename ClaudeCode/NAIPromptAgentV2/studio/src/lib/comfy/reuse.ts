// Client-safe: Item is a type-only import.
import type { PhotoRecipe, VideoRecipe } from "./recipe";
import type { Item } from "./store";

/** Where a Library item's recipe goes. The stored seed is the one that ran (a -1 recipe seed was resolved at submit). */
export function reuseTarget(it: Item): { pane: "photo"; recipe: PhotoRecipe } | { pane: "video"; recipe: VideoRecipe } {
  return it.kind === "photo"
    ? { pane: "photo", recipe: { ...(it.recipe as PhotoRecipe), seed: it.seed, pose: null } } // pose images are session-only in the pane
    : { pane: "video", recipe: { ...(it.recipe as VideoRecipe), seed: it.seed, start: null, end: null } } // the start item may be gone; the user picks frames again
}

/** Send a photo to Video: it becomes the start frame in animate mode. */
export function asStartFrame(it: Item, v: VideoRecipe): VideoRecipe {
  const { startImage: _drop, ...rest } = v;
  return { ...rest, mode: "animate", start: it.id, end: null };
}
