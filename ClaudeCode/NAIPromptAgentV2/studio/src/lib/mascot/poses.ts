// Full-body pose catalogue (Plan 19). Pure data + fallback; request/path builders live in sprites.ts.
export const POSES = ["stand", "lie", "apose", "peek", "lean", "sit", "legs", "back"] as const;
export type Pose = (typeof POSES)[number];

const BG = "simple background, white background";
/** Per-pose framing tags, canvas size, and whether she shows a face (back view has no expression). */
export const POSE_SPEC: Record<Pose, { tags: string; width: number; height: number; faced: boolean }> = {
  stand: { tags: `full body, standing, hand on hip, looking at viewer, ${BG}`, width: 832, height: 1216, faced: true },
  lie: { tags: `lying on stomach, full body, from side, chin on hands, looking at viewer, ${BG}`, width: 1216, height: 832, faced: true },
  apose: { tags: `a-pose, full body, standing, arms at sides, looking at viewer, ${BG}`, width: 832, height: 1216, faced: true },
  peek: { tags: `peeking, peeking out from behind, upper body, hands on edge, looking at viewer, ${BG}`, width: 832, height: 1216, faced: true },
  lean: { tags: `leaning forward, full body, hands on own knees, looking at viewer, ${BG}`, width: 832, height: 1216, faced: true },
  sit: { tags: `sitting, full body, legs together, hands on lap, looking at viewer, ${BG}`, width: 1024, height: 1024, faced: true },
  legs: { tags: `sitting, legs up, crossed legs, full body, from side, looking at viewer, ${BG}`, width: 1024, height: 1024, faced: true },
  back: { tags: `from behind, back view, full body, hands on hips, looking at screen, ${BG}`, width: 832, height: 1216, faced: false },
};

/** Listing key: `pose/<pose>/<outfit>/<expr>`, or `pose/back/<outfit>` (no expression). */
export const poseKey = (pose: Pose, outfit: string, expr: string | null): string =>
  pose === "back" || expr === null ? `pose/${pose}/${outfit}` : `pose/${pose}/${outfit}/${expr}`;

/** Pose part of the fallback chain only: pose+expr → pose/smug → stand/expr → stand/smug; null → caller falls back to the bust pickSprite/placeholder. */
export function pickPoseSprite(have: Set<string>, pose: Pose, outfit: string, expr: string): string | null {
  const chain = pose === "back" ? [poseKey("back", outfit, null), poseKey("stand", outfit, expr), poseKey("stand", outfit, "smug")]
    : [poseKey(pose, outfit, expr), poseKey(pose, outfit, "smug"), poseKey("stand", outfit, expr), poseKey("stand", outfit, "smug")];
  return chain.find((k) => have.has(k)) ?? null;
}
