"use client";
import { useEffect, useRef } from "react";
import type { LibClip, Library } from "@/lib/sprites/core";
import { clipDir, frameAt, initial, request, tick, type PlayerState } from "@/lib/sprites/player";

const WAIT_MS = 400, FADE_MS = 160;
const url = (c: LibClip, i: number) => `/api/sprites/library/file/${c.surface}/${c.outfit}/${clipDir(c)}/${String(i).padStart(3, "0")}.webp?v=${c.v}`;
const dirKey = (c: LibClip) => `${c.surface}/${c.outfit}/${clipDir(c)}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Canvas player for the Chat portrait: the current idle loops, a mood change plays the transition clip (or its mirror backwards),
 *  and a transition that isn't decoded within 400 ms becomes a crossfade. The canvas keeps the previous frame until the next is ready. */
export function ClipPortrait({ lib, outfit, expression, className = "" }: { lib: Library; outfit: string; expression: string; className?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const L = useRef({ lib, outfit });
  L.current = { lib, outfit };
  const st = useRef<PlayerState>(initial(lib, outfit, expression, performance.now()));
  type Entry = { p: Promise<(ImageBitmap | null)[]>; done: (ImageBitmap | null)[] | null; dead: boolean };
  const bmps = useRef(new Map<string, Entry>()); // decoded frames per clip folder: current idle + active transition only
  const width = useRef(480);
  const reduced = useRef(false);
  const ver = useRef(0);
  const gone = useRef(false);
  const shown = useRef<{ b: ImageBitmap | null; orphan: ImageBitmap | null }>({ b: null, orphan: null }); // orphan = shown frame of an evicted clip, closed once replaced

  const load = (c: LibClip): Promise<unknown> => {
    const k = dirKey(c);
    let e = bmps.current.get(k);
    if (!e && !gone.current) {
      const n: Entry = { done: null, dead: false, p: null as never };
      n.p = Promise.all(Array.from({ length: c.frames }, async (_, i) => {
        try {
          const r = await fetch(url(c, i));
          const b = r.ok ? await createImageBitmap(await r.blob(), { resizeWidth: width.current }) : null;
          if (b && n.dead) { b.close(); return null; } // evicted or unmounted while decoding
          return b;
        } catch { return null; }
      })).then((a) => (n.done = a));
      bmps.current.set(k, n); e = n;
    }
    return e?.p ?? Promise.resolve([]);
  };
  const evict = (k: string) => {
    const e = bmps.current.get(k);
    if (!e) return;
    bmps.current.delete(k); e.dead = true;
    e.p.then((a) => a.forEach((b) => { if (!b) return; if (b === shown.current.b) shown.current.orphan = b; else b.close(); }));
  };
  const prune = () => {
    const { seg, at } = st.current, keep = new Set<string>();
    if (seg) keep.add(dirKey(seg.clip));
    const idle = L.current.lib.clips.find((c) => c.surface === "chat" && c.outfit === L.current.outfit && c.from === at && c.to === at);
    if (idle) keep.add(dirKey(idle));
    for (const k of [...bmps.current.keys()]) if (!keep.has(k)) evict(k);
  };

  useEffect(() => {
    gone.current = false;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)"), on = () => { reduced.current = m.matches; };
    on(); m.addEventListener("change", on);
    const c = cv.current!, g = c.getContext("2d")!;
    let drawn: ImageBitmap | null = null; // what the canvas holds; a resize clears it
    const fit = () => { const d = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(1, Math.round(c.clientWidth * d)); c.height = Math.max(1, Math.round(c.clientHeight * d)); width.current = Math.min(480, c.width); drawn = null; };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    const snap = document.createElement("canvas"); // previous frame, faded out under a crossfade
    let fade = 0, segDir = "", raf = 0;
    const frame = (now: number) => {
      if (gone.current) return;
      const { lib: l, outfit: o } = L.current;
      st.current = tick(st.current, l, o, now);
      const s = st.current, f = frameAt(s, now);
      let b = shown.current.b;
      if (f) {
        const k = dirKey(f.clip);
        if (k !== segDir) { // new clip: crossfade into idles, hard cut into transitions (their first frame is the previous idle's)
          if (segDir && s.seg?.loop && c.width) { snap.width = c.width; snap.height = c.height; snap.getContext("2d")!.drawImage(c, 0, 0); fade = now; }
          segDir = k; prune();
        }
        const e = bmps.current.get(k);
        if (!e) void load(f.clip);
        const nb = e?.done?.[reduced.current ? 0 : f.index];
        if (nb && nb !== b) { b = nb; const old = shown.current.orphan; shown.current = { b: nb, orphan: null }; old?.close(); }
      }
      const fading = fade && now - fade < FADE_MS;
      if (b && c.width && (b !== drawn || fading || fade)) {
        g.clearRect(0, 0, c.width, c.height);
        const sc = Math.min(c.width / b.width, c.height / b.height), w = b.width * sc, h = b.height * sc;
        g.drawImage(b, (c.width - w) / 2, c.height - h, w, h);
        if (fading) { g.globalAlpha = 1 - (now - fade) / FADE_MS; g.drawImage(snap, 0, 0); g.globalAlpha = 1; } else fade = 0;
        drawn = b;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      gone.current = true; cancelAnimationFrame(raf); ro.disconnect(); m.removeEventListener("change", on);
      const { b, orphan } = shown.current; shown.current = { b: null, orphan: null };
      for (const k of [...bmps.current.keys()]) evict(k);
      b?.close(); orphan?.close();
    };
  }, []);

  // A new expression: warm the transition + target idle, wait up to 400 ms, else crossfade straight to the target idle.
  useEffect(() => {
    const my = ++ver.current, { lib: l, outfit: o } = L.current, s0 = st.current;
    if (expression === s0.at && !s0.pending) return;
    (async () => {
      const tr = request({ ...s0, seg: null }, expression, l, o, 0).seg; // what a settled player would play
      const idle = l.clips.find((c) => c.surface === "chat" && c.outfit === o && c.from === expression && c.to === expression);
      const trP = tr && !tr.loop ? load(tr.clip) : null, idleP = idle && load(idle);
      const ok = !!trP && !reduced.current && (await Promise.race([trP.then(() => true), sleep(WAIT_MS).then(() => false)]));
      await idleP; // the idle we land on must be decoded either way (a crossfade needs its first frame)
      if (my !== ver.current) return;
      const none = (c: LibClip) => c.from === c.to || !((c.from === s0.at && c.to === expression) || (c.from === expression && c.to === s0.at));
      st.current = request(st.current, expression, ok ? l : { ...l, clips: l.clips.filter(none) }, o, performance.now());
    })();
  }, [expression]);

  return <canvas ref={cv} role="img" aria-label="Miyabi" className={className} />;
}
