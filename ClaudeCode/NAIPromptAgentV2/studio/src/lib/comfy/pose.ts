// Pure OpenPose body-keypoint model for the pose editor. Client-safe: no server imports.
export type Kp = [x: number, y: number, c: number]; // normalised 0–1

// Standard OpenPose 18-point limb pairs (0-indexed) with ControlNet colours.
export const LIMBS: [number, number, string][] = [
  [1, 2, "#ff0000"], [1, 5, "#ff5500"], [2, 3, "#ffaa00"], [3, 4, "#ffff00"],
  [5, 6, "#aaff00"], [6, 7, "#55ff00"], [1, 8, "#00ff00"], [8, 9, "#00ff55"],
  [9, 10, "#00ffaa"], [1, 11, "#00ffff"], [11, 12, "#00aaff"], [12, 13, "#0055ff"],
  [1, 0, "#0000ff"], [0, 14, "#5500ff"], [14, 16, "#aa00ff"], [0, 15, "#ff00ff"],
  [15, 17, "#ff00aa"],
];

const SWAP = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16];
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** First person of the first frame (array or single frame), normalised by canvas size. */
export function fromOpenPose(json: unknown): Kp[] | null {
  const frame = Array.isArray(json) ? json[0] : json;
  if (!frame || typeof frame !== "object") return null;
  const f = frame as { canvas_width?: unknown; canvas_height?: unknown; people?: unknown };
  const { canvas_width: w, canvas_height: h } = f;
  if (!num(w) || !num(h) || w <= 0 || h <= 0 || !Array.isArray(f.people)) return null;
  const raw = (f.people[0] as { pose_keypoints_2d?: unknown } | undefined)?.pose_keypoints_2d;
  if (!Array.isArray(raw) || raw.length < 54 || !raw.slice(0, 54).every(num)) return null;
  return Array.from({ length: 18 }, (_, i): Kp => {
    const [x, y, c] = raw.slice(i * 3, i * 3 + 3) as number[];
    return c === 0 || (x === 0 && y === 0) ? [0, 0, 0] : [clamp(x / w), clamp(y / h), c];
  });
}

export function mirror(k: Kp[]): Kp[] {
  return k.map((_, i) => {
    const [x, y, c] = k[SWAP[i]];
    return c === 0 ? [0, 0, 0] : [1 - x, y, c];
  });
}

export function moveJoint(k: Kp[], i: number, x: number, y: number): Kp[] {
  return k.map((p, j) => (j === i ? [clamp(x), clamp(y), 1] : p));
}
