// Mascot frame clips (Plan 22; pure, client-safe: no node imports): kinds, per-kind spec, manifest, whitelisted paths, request descriptors and the pure playback state machine.
import type { NaiParams } from "../nai-body";
import type { Compiled } from "../prompt";
import { EXPRESSIONS, OUTFITS } from "./core";
import { POSES } from "./poses";
import { TALK_FRAMES } from "./talk";

export const CLIP_KINDS = ["blink", "talk", "laugh", "pout", "wink", "wave", "jump"] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];
export type MaskName = "eyes" | "mouth";
export type Mask = { x: number; y: number; w: number; h: number };

/** Per kind: frame count, playback fps/loop, generation method (+ img2img strength or the infill mask) and per-frame tags (appended to the base prompt). */
export const CLIP_SPEC: Record<ClipKind, { frames: number; fps: number; loop: boolean; method: "infill" | "img2img"; mask?: MaskName; strength?: number; tags: readonly string[] }> = {
  blink: { frames: 1, fps: 8, loop: false, method: "infill", mask: "eyes", tags: ["closed eyes"] },
  talk: { frames: 2, fps: 8, loop: true, method: "infill", mask: "mouth", tags: ["parted lips", "open mouth"] },
  laugh: { frames: 3, fps: 8, loop: false, method: "img2img", strength: 0.45, tags: Array(3).fill("laughing, closed eyes, open mouth") },
  pout: { frames: 3, fps: 8, loop: false, method: "img2img", strength: 0.4, tags: Array(3).fill("pout, puffed cheeks") },
  wink: { frames: 3, fps: 8, loop: false, method: "img2img", strength: 0.4, tags: Array(3).fill("one eye closed, smile") },
  wave: { frames: 4, fps: 6, loop: false, method: "img2img", strength: 0.5, tags: ["waving, hand up", "waving, hand to side", "waving, hand up", "waving, hand to side"] },
  jump: { frames: 4, fps: 6, loop: false, method: "img2img", strength: 0.55, tags: ["jumping, arms up", "midair", "landing, knees bent", "standing"] },
};
export const isClipKind = (k: unknown): k is ClipKind => CLIP_KINDS.includes(k as ClipKind);

// --- baseKey: exactly the listing key shapes (`outfit/expr|full`, `pose/<pose>/<outfit>/<expr>`, `pose/back/<outfit>`, `talk/<outfit>/<frame>`) ---
const O = (o: string) => OUTFITS.includes(o as never), E = (e: string) => EXPRESSIONS.includes(e as never);
/** Is this an existing-shape listing key? */
export function isBaseKey(k: unknown): k is string {
  if (typeof k !== "string") return false;
  const p = k.split("/");
  if (p[0] === "pose") return POSES.includes(p[1] as never) && (p[1] === "back" ? p.length === 3 && O(p[2]) : p.length === 4 && O(p[2]) && E(p[3]));
  if (p[0] === "talk") return p.length === 3 && O(p[1]) && TALK_FRAMES.includes(p[2] as never);
  return p.length === 2 && O(p[0]) && (E(p[1]) || p[1] === "full");
}
/** Path-safe directory name for a baseKey: "/" becomes "~" (never appears in a valid key); null if invalid. */
export const encodeBaseKey = (k: string): string | null => (isBaseKey(k) ? k.replaceAll("/", "~") : null);
export const decodeBaseKey = (d: string): string | null => { const k = d.replaceAll("~", "/"); return isBaseKey(k) ? k : null; };

/** `<dir>/clips/<baseKey~>/<kind>/<n>.png`; n is 0-based, < the kind's frame count. */
export function clipPath(dir: string, baseKey: string, kind: string, n: number): string | null {
  const e = encodeBaseKey(baseKey);
  return e && isClipKind(kind) && Number.isInteger(n) && n >= 0 && n < CLIP_SPEC[kind].frames ? `${dir}/clips/${e}/${kind}/${n}.png` : null;
}
export function manifestPath(dir: string, baseKey: string): string | null {
  const e = encodeBaseKey(baseKey);
  return e ? `${dir}/clips/${e}/manifest.json` : null;
}

// --- masks ---
/** Normalised box defaults: full-body (poses, outfit/full) vs bust/talk portrait. */
export function defaultMasks(baseKey: string): Record<MaskName, Mask> {
  const full = baseKey.startsWith("pose/") || baseKey.endsWith("/full");
  return full
    ? { eyes: { x: 0.42, y: 0.1, w: 0.16, h: 0.04 }, mouth: { x: 0.45, y: 0.14, w: 0.1, h: 0.03 } }
    : { eyes: { x: 0.32, y: 0.3, w: 0.36, h: 0.1 }, mouth: { x: 0.4, y: 0.44, w: 0.2, h: 0.08 } };
}
const unit = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
/** Untrusted box → 0..1 values that stay inside the sprite (x+w, y+h ≤ 1). */
export function clampMask(m: unknown): Mask {
  const r = (m ?? {}) as Record<string, unknown>, x = unit(r.x), y = unit(r.y);
  return { x, y, w: Math.min(unit(r.w), 1 - x), h: Math.min(unit(r.h), 1 - y) };
}

// --- manifest ---
export type ClipInfo = { frames: number; fps: number; loop: boolean };
export type Manifest = { masks?: Partial<Record<MaskName, Mask>>; clips: Partial<Record<ClipKind, ClipInfo>> };

/** Untrusted JSON → a clean Manifest, or null if any kind is unknown or any entry is malformed (frames 1..spec, fps in (0,60], loop boolean). Masks are clamped. */
export function validateManifest(raw: unknown): Manifest | null {
  const r = raw as { masks?: Record<string, unknown>; clips?: Record<string, unknown> } | null;
  if (!r || typeof r !== "object" || !r.clips || typeof r.clips !== "object" || Array.isArray(r.clips)) return null;
  const clips: Manifest["clips"] = {};
  for (const [k, v] of Object.entries(r.clips)) {
    const c = v as Partial<ClipInfo> | null;
    if (!isClipKind(k) || !c || !Number.isInteger(c.frames) || c.frames! < 1 || c.frames! > CLIP_SPEC[k].frames
      || typeof c.fps !== "number" || !(c.fps > 0 && c.fps <= 60) || typeof c.loop !== "boolean") return null;
    clips[k] = { frames: c.frames!, fps: c.fps, loop: c.loop };
  }
  const out: Manifest = { clips };
  if (r.masks && typeof r.masks === "object") {
    const masks: NonNullable<Manifest["masks"]> = {};
    for (const n of ["eyes", "mouth"] as const) if (r.masks[n] !== undefined) masks[n] = clampMask(r.masks[n]);
    out.masks = masks;
  }
  return out;
}

// --- generation requests (descriptors only; Task 2 builds the NovelAI body) ---
export type ClipRequest = { compiled: Compiled; params: NaiParams; img2img?: { strength: number }; infill?: true; mask?: MaskName };

/** One request per frame: the base prompt + that frame's tags, same seed across the clip, UC unchanged. */
export function clipRequests(base: { compiled: Compiled; params: NaiParams }, kind: ClipKind, seed: number): ClipRequest[] {
  const s = CLIP_SPEC[kind];
  return s.tags.map((tag) => ({
    compiled: { ...base.compiled, base: [base.compiled.base.trim(), tag].filter(Boolean).join(", ") },
    params: { ...base.params, seed },
    ...(s.method === "infill" ? { infill: true as const, mask: s.mask } : { img2img: { strength: s.strength! } }),
  }));
}

// --- playback: pure state machine, priorities talk > reaction > blink > idle ---
export type PlayerState = { clips: Manifest["clips"]; empty: boolean; cur: { kind: ClipKind; start: number } | null };
const prio = (k: ClipKind) => (k === "talk" ? 3 : k === "blink" ? 1 : 2);

export const ClipPlayer = {
  /** clips = the base sprite's manifest clips (none → stills only); empty = empty slime (never plays). */
  init: (clips: Manifest["clips"] = {}, empty = false): PlayerState => ({ clips, empty, cur: null }),

  /** Start a clip unless it is missing, the slime is empty, or a higher-priority clip is still running. The same looping clip keeps its phase. */
  play(st: PlayerState, kind: ClipKind, now: number): PlayerState {
    if (st.empty || !st.clips[kind]) return st;
    const live = ClipPlayer.tick(st, now);
    if (live.kind && prio(live.kind) > prio(kind)) return st;
    if (live.kind === kind && st.clips[kind]!.loop) return st;
    return { ...st, cur: { kind, start: now } };
  },

  /** End a looping clip (talk end/error); a no-op if it isn't the current one. */
  stop: (st: PlayerState, kind: ClipKind): PlayerState => (st.cur?.kind === kind ? { ...st, cur: null } : st),

  /** Current clip frame at time now (ms), or { null, null } = show the current expression still (a finished one-shot returns there). */
  tick(st: PlayerState, now: number): { kind: ClipKind | null; frame: number | null } {
    const c = st.cur, info = c && st.clips[c.kind];
    if (st.empty || !c || !info) return { kind: null, frame: null };
    const i = Math.floor(Math.max(0, now - c.start) * info.fps / 1000);
    if (info.loop) return { kind: c.kind, frame: i % info.frames };
    return i < info.frames ? { kind: c.kind, frame: i } : { kind: null, frame: null };
  },
};
