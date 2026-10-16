// Mascot clip playback glue (Plan 22; pure, client-safe): sprite listing → ClipPlayer input, clip frame URLs, and which reaction an event gets.
import { CLIP_SPEC, clipPath, isClipKind, type ClipKind, type Manifest } from "./clips";
import type { Expression } from "./core";
import type { ClipListing } from "./sprites";

export type Clips = Pick<ClipListing, "clips"> & { clipMeta: Record<string, { v: number }> };

/** A base sprite's picked clips as ClipPlayer input: listing frame counts (1..spec) with the spec's fps/loop; anything else dropped. */
export function clipsFor(l: Clips | null, key: string | null): Manifest["clips"] {
  const out: Manifest["clips"] = {}, c = (key && l?.clips[key]) || {};
  for (const [k, n] of Object.entries(c)) if (isClipKind(k) && Number.isInteger(n) && n! >= 1 && n! <= CLIP_SPEC[k].frames) out[k] = { frames: n!, fps: CLIP_SPEC[k].fps, loop: CLIP_SPEC[k].loop };
  return out;
}

/** Served URL of picked frame n (0-based), or null for a bad key/kind/frame. */
export function clipUrl(l: Clips | null, key: string, kind: ClipKind, n: number, aru = false): string | null {
  const p = clipPath("/api/mascot/sprites", key, kind, n);
  return p && `${p.slice(0, -4)}?v=${l?.clipMeta[key]?.v ?? 0}${aru ? "&profile=aru" : ""}`;
}

/** Every picked frame URL of one base sprite (preload when it appears). */
export function clipUrls(l: Clips | null, key: string | null, aru = false): string[] {
  return Object.entries(clipsFor(l, key)).flatMap(([k, c]) => Array.from({ length: c.frames }, (_, n) => clipUrl(l, key!, k as ClipKind, n, aru)!));
}

export type ReactEvent = "poke" | "pat" | "flick" | "drop" | "generated" | "upscaled" | "vial_drop" | "brewed";
const HAPPY: readonly Expression[] = ["laughing", "flirty", "smug", "excited", "wink"];

/** Playback table: poke → laugh/pout by mood, pat → wink, flick/drop → pout, generated/upscaled/vial_drop/brewed → jump or wave. */
export function reactionFor(ev: ReactEvent, mood: Expression, rand: () => number): ClipKind {
  if (ev === "poke") return HAPPY.includes(mood) ? "laugh" : "pout";
  if (ev === "pat") return "wink";
  if (ev === "flick" || ev === "drop") return "pout";
  return rand() < 0.5 ? "jump" : "wave";
}

/** Texture size for an iw×ih image shown in a bw×bh backing box: contain-fit, never upscaled, integer ≥ 1; an unmeasured box (0) keeps full size. */
export function texSize(iw: number, ih: number, bw: number, bh: number): { w: number; h: number } {
  const s = bw > 0 && bh > 0 ? Math.min(1, bw / iw, bh / ih) : 1;
  return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
}

/** WebGL context recovery: allowed while fewer than 3 losses happened in the last minute (losses = timestamps, ms). */
export const canRestore = (losses: readonly number[], now: number): boolean => losses.filter((t) => now - t < 60_000).length < 3;
