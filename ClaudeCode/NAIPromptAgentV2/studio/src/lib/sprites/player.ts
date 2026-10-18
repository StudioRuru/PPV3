// Pure clip player (Chat portrait and Stage): which clip plays when, no DOM. Client-safe (types only from core).
import type { LibClip, Library, Surface } from "./core";

export type Seg = { clip: LibClip; reversed: boolean; loop: boolean };
/** at = the expression being played or heading to; pending = the latest queued target while a transition runs. */
export type PlayerState = { at: string; seg: Seg | null; startedAt: number; pending: string | null };

const find = (lib: Library, surface: Surface, outfit: string, from: string, to: string) =>
  lib.clips.find((c) => c.surface === surface && c.outfit === outfit && c.from === from && c.to === to);

/** First frame equals the last, so idles play 0..n-2. */
export const dropLoopSeam = (n: number) => Math.max(1, n - 1);
/** Frame folder of a clip (a listed reverse cell reads its mirror's frames). */
export const clipDir = (c: LibClip) => c.reverseOf ?? `${c.from}~${c.to}`;
export const clipMs = (c: LibClip) => (c.frames / c.fps) * 1000;

export function idleSeg(lib: Library, surface: Surface, outfit: string, key: string): Seg | null {
  const clip = find(lib, surface, outfit, key, key);
  return clip ? { clip, reversed: false, loop: true } : null;
}

/** Own clip, else the mirror played backwards, else a crossfade. */
export function route(lib: Library, surface: Surface, outfit: string, from: string, to: string): Seg | "crossfade" {
  const own = find(lib, surface, outfit, from, to);
  if (own) return { clip: own, reversed: !!own.reverseOf, loop: false };
  const mirror = find(lib, surface, outfit, to, from);
  return mirror && !mirror.reverseOf ? { clip: mirror, reversed: true, loop: false } : "crossfade";
}

export const initial = (lib: Library, outfit: string, at: string, now: number, surface: Surface = "chat"): PlayerState => ({ at, seg: idleSeg(lib, surface, outfit, at), startedAt: now, pending: null });

export function request(s: PlayerState, to: string, lib: Library, outfit: string, now: number, surface: Surface = "chat"): PlayerState {
  if (s.seg && !s.seg.loop) return { ...s, pending: to === s.at ? null : to }; // mid-transition: only the latest target waits
  if (to === s.at) return s;
  const r = route(lib, surface, outfit, s.at, to);
  return r === "crossfade" ? initial(lib, outfit, to, now, surface) : { at: to, seg: r, startedAt: now, pending: null };
}

export function tick(s: PlayerState, lib: Library, outfit: string, now: number, surface: Surface = "chat"): PlayerState {
  if (!s.seg) return idleSeg(lib, surface, outfit, s.at) ? initial(lib, outfit, s.at, now, surface) : s;
  if (s.seg.loop || now - s.startedAt < clipMs(s.seg.clip)) return s;
  const settled = initial(lib, outfit, s.at, now, surface);
  return s.pending ? request(settled, s.pending, lib, outfit, now, surface) : settled;
}

export function frameAt(s: PlayerState, now: number): { clip: LibClip; index: number } | null {
  if (!s.seg) return null;
  const { clip, reversed, loop } = s.seg, n = clip.frames;
  const step = Math.max(0, Math.floor(((now - s.startedAt) / 1000) * clip.fps));
  const i = loop ? step % dropLoopSeam(n) : Math.min(step, n - 1);
  return { clip, index: reversed ? n - 1 - i : i };
}
