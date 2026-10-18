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
  const bmps = useRef(new Map<string, Promise<(ImageBitmap | null)[]>>()); // decoded frames per clip folder: current idle + active transition only
  const width = useRef(480);
  const reduced = useRef(false);
  const ver = useRef(0);

  const load = (c: LibClip) => {
    const k = dirKey(c);
    let p = bmps.current.get(k);
    if (!p) {
      p = Promise.all(Array.from({ length: c.frames }, async (_, i) => {
        try {
          const r = await fetch(url(c, i));
          return r.ok ? await createImageBitmap(await r.blob(), { resizeWidth: width.current }) : null;
        } catch { return null; }
      }));
      bmps.current.set(k, p);
    }
    return p;
  };
  const prune = () => {
    const { seg, at } = st.current, keep = new Set<string>();
    if (seg) keep.add(dirKey(seg.clip));
    const idle = L.current.lib.clips.find((c) => c.surface === "chat" && c.outfit === L.current.outfit && c.from === at && c.to === at);
    if (idle) keep.add(dirKey(idle));
    for (const k of [...bmps.current.keys()]) if (!keep.has(k)) bmps.current.delete(k); // GC frees them; `last` may still show one, so no close()
  };

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)"), on = () => { reduced.current = m.matches; };
    on(); m.addEventListener("change", on);
    const c = cv.current!, g = c.getContext("2d")!;
    const fit = () => { const d = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(1, Math.round(c.clientWidth * d)); c.height = Math.max(1, Math.round(c.clientHeight * d)); width.current = Math.min(480, c.width); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    const snap = document.createElement("canvas"); // previous frame, faded out under a crossfade
    let fade = 0, segDir = "", raf = 0, alive = true, last: ImageBitmap | null = null;
    const paint = (b: ImageBitmap, a = 1) => {
      const s = Math.min(c.width / b.width, c.height / b.height), w = b.width * s, h = b.height * s;
      g.globalAlpha = a; g.drawImage(b, (c.width - w) / 2, c.height - h, w, h); g.globalAlpha = 1;
    };
    const frame = (now: number) => {
      if (!alive) return;
      const { lib: l, outfit: o } = L.current;
      st.current = tick(st.current, l, o, now);
      const s = st.current, f = frameAt(s, now);
      if (f) {
        const k = dirKey(f.clip);
        if (k !== segDir) { // new clip: crossfade into idles, hard cut into transitions (their first frame is the previous idle's)
          if (segDir && s.seg?.loop && c.width) { snap.width = c.width; snap.height = c.height; snap.getContext("2d")!.drawImage(c, 0, 0); fade = now; }
          segDir = k; prune();
        }
        load(f.clip).then((a) => { last = a[reduced.current ? 0 : f.index] ?? last; });
      }
      if (last && c.width) {
        g.clearRect(0, 0, c.width, c.height);
        paint(last);
        if (fade && now - fade < FADE_MS) { g.globalAlpha = 1 - (now - fade) / FADE_MS; g.drawImage(snap, 0, 0); g.globalAlpha = 1; } else fade = 0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); m.removeEventListener("change", on); const all = [...bmps.current.values()]; bmps.current.clear(); all.forEach((p) => p.then((a) => a.forEach((b) => b?.close()))); };
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
