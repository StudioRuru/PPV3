"use client";
import { useEffect, useImperativeHandle, useReducer, useRef, useState, type CSSProperties, type Ref } from "react";
import { kick, stepSpring, usesXBands, WARP, type Spring } from "@/lib/mascot/anim";
import { ClipPlayer, type ClipKind, type Manifest } from "@/lib/mascot/clips";
import type { Pose } from "@/lib/mascot/poses";

export type SpriteHandle = {
  /** Whole-body squash impulse (spring velocity, ~1 pat .. 3 drop); false = no live canvas (caller may fall back to a CSS jiggle). */
  kick(impulse: number): boolean;
  /** Pointer velocity while carried, -1..1 in sprite space (+ = moving right); the top band lags behind and springs back. */
  drag(vx: number): void;
};
type Props = {
  src: string; pose?: Pose; empty?: boolean;
  /** The canvas overhangs the box (10% each side, 12% above) so warped edges aren't clipped: for a box the sprite fills exactly. */
  bleed?: boolean;
  alt?: string; className?: string; style?: CSSProperties; ref?: Ref<SpriteHandle>;
};

const FADE_MS = 100, COLS = 16, ROWS = 24, LRU = 6, DPR_MAX = 2, PAD = { x: 0.1, top: 0.12 };
const REST: Spring = { x: 0, v: 0 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// GPU twin of anim.ts vertexOffset (uniforms fed from WARP; bands written as ramps that are 0 outside, so no branches).
const VS = `
attribute vec2 a_uv;
uniform vec4 u_rect; // sprite box in canvas space (0..1, y down)
uniform float u_sway, u_breathe, u_drag, u_squash;
uniform vec3 u_head;  // weight = clamp((c - x) / (y - x)); z = 1: bands along x (lie/sit)
uniform vec3 u_chest; // from, to, band amplitude
uniform vec4 u_k;     // swayAmp, breatheAmp, dragGain, squashShift
varying vec2 v_uv;
void main() {
  float c = mix(a_uv.y, a_uv.x, u_head.z);
  float wh = clamp((c - u_head.x) / (u_head.y - u_head.x), 0.0, 1.0);
  float wc = max(0.0, 1.0 - abs(c - 0.5 * (u_chest.x + u_chest.y)) / (0.5 * (u_chest.y - u_chest.x)));
  vec2 d = vec2((u_sway * u_k.x - u_drag * u_k.z) * wh, -u_breathe * u_k.y * wc) * u_chest.z;
  d += vec2((a_uv.x - 0.5) * u_squash * u_k.w, (1.0 - a_uv.y) * u_squash);
  vec2 p = u_rect.xy + (a_uv + d) * u_rect.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
}`;
const FS = `
precision mediump float;
uniform sampler2D u_a, u_b; uniform float u_mix; varying vec2 v_uv;
void main() { gl_FragColor = mix(texture2D(u_a, v_uv), texture2D(u_b, v_uv), u_mix); }`; // premultiplied in, premultiplied out

type Tex = { t: WebGLTexture; w: number; h: number };

/** Live sprite: WebGL warp (idle sway/breathe, squash, drag lag) with crossfaded frame swaps; one rAF while on screen.
 *  Falls back to a plain <img> on reduced motion, any WebGL failure or context loss; the <img> also stands in until the first frame draws. */
export function SpriteCanvas({ src, pose = "stand", empty = false, bleed = false, alt = "", className = "", style, ref }: Props) {
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const g = useRef<{ show(url: string): void; kick(i: number): void; drag(vx: number): void } | null>(null);
  const live = useRef({ pose, empty, bleed });
  live.current = { pose, empty, bleed };
  const srcRef = useRef(src);
  srcRef.current = src;
  const gl = !failed && !reduced;

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useImperativeHandle(ref, () => ({ kick: (i) => (g.current ? (g.current.kick(i), true) : false), drag: (vx) => g.current?.drag(vx) }), []);

  useEffect(() => {
    const el = canvas.current;
    if (!gl || !el) return;
    let dead = false, raf = 0, last = 0, t = 0, seen = true, first = true, w = 1, h = 1;
    let cur: Tex | null = null, prev: Tex | null = null, fadeAt = 0, want = "", squash = REST, lag = REST;
    const cache = new Map<string, Tex>(), loading = new Set<string>(), rect = [0, 0, 1, 1];
    const fail = () => { if (!dead) { stop(); setFailed(true); } };
    const c = el.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!c) { setFailed(true); return; }
    const x = c;

    const sh = (type: number, s: string) => { const o = x.createShader(type)!; x.shaderSource(o, s); x.compileShader(o); if (!x.getShaderParameter(o, x.COMPILE_STATUS)) throw new Error(x.getShaderInfoLog(o) ?? "shader"); return o; };
    let U: Record<string, WebGLUniformLocation | null>, nIdx = 0;
    try {
      const prog = x.createProgram()!;
      x.attachShader(prog, sh(x.VERTEX_SHADER, VS)); x.attachShader(prog, sh(x.FRAGMENT_SHADER, FS)); x.linkProgram(prog);
      if (!x.getProgramParameter(prog, x.LINK_STATUS)) throw new Error("link");
      x.useProgram(prog);
      U = Object.fromEntries(["u_rect", "u_sway", "u_breathe", "u_drag", "u_squash", "u_head", "u_chest", "u_k", "u_a", "u_b", "u_mix"].map((n) => [n, x.getUniformLocation(prog, n)]));
      // (COLS+1)×(ROWS+1) grid in sprite uv
      const uv = new Float32Array((COLS + 1) * (ROWS + 1) * 2), idx = new Uint16Array(COLS * ROWS * 6);
      for (let j = 0, k = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) { uv[k++] = i / COLS; uv[k++] = j / ROWS; }
      for (let j = 0, k = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const a = j * (COLS + 1) + i, b = a + COLS + 1; idx.set([a, a + 1, b, a + 1, b + 1, b], k); k += 6; }
      nIdx = idx.length;
      x.bindBuffer(x.ARRAY_BUFFER, x.createBuffer()); x.bufferData(x.ARRAY_BUFFER, uv, x.STATIC_DRAW);
      x.bindBuffer(x.ELEMENT_ARRAY_BUFFER, x.createBuffer()); x.bufferData(x.ELEMENT_ARRAY_BUFFER, idx, x.STATIC_DRAW);
      const a = x.getAttribLocation(prog, "a_uv"); x.enableVertexAttribArray(a); x.vertexAttribPointer(a, 2, x.FLOAT, false, 0, 0);
      x.uniform1i(U.u_a, 0); x.uniform1i(U.u_b, 1);
      x.uniform4f(U.u_k, WARP.swayAmp, WARP.breatheAmp, WARP.dragGain, WARP.squashShift);
      x.enable(x.BLEND); x.blendFunc(x.ONE, x.ONE_MINUS_SRC_ALPHA);
      x.pixelStorei(x.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      x.clearColor(0, 0, 0, 0);
    } catch (e) { console.warn("SpriteCanvas: WebGL init failed", e); setFailed(true); return; }

    /** Sprite box: contain-fit, bottom-centred, inside the canvas minus the bleed overhang. */
    const fit = () => {
      if (!cur) return;
      const b = live.current.bleed, aw = b ? 1 / (1 + 2 * PAD.x) : 1, ah = b ? 1 / (1 + PAD.top) : 1;
      const A = (aw * w) / (ah * h), r = cur.w / cur.h, fw = r > A ? aw : (aw * r) / A, fh = r > A ? (ah * A) / r : ah;
      rect[0] = (1 - fw) / 2; rect[1] = 1 - fh; rect[2] = fw; rect[3] = fh;
    };
    const swap = (tx: Tex) => {
      if (tx === cur) return;
      const fade = cur && Math.abs(cur.w / cur.h - tx.w / tx.h) < 0.01; // different shape (pose change): hard cut, a fade would smear
      prev = fade ? cur : tx; cur = tx; fadeAt = performance.now();
      fit(); go();
    };
    const evict = () => {
      for (const [k, v] of cache) { if (cache.size <= LRU) break; if (v !== cur && v !== prev) { x.deleteTexture(v.t); cache.delete(k); } }
    };
    const show = (url: string) => {
      want = url;
      const hit = cache.get(url);
      if (hit) { cache.delete(url); cache.set(url, hit); swap(hit); return; }
      if (loading.has(url)) return; // already on its way; `want` decides whether it swaps in
      loading.add(url);
      const img = new Image();
      img.onload = () => {
        loading.delete(url);
        if (dead || x.isContextLost()) return;
        const t = x.createTexture()!;
        x.activeTexture(x.TEXTURE2); x.bindTexture(x.TEXTURE_2D, t); // scratch unit: units 0/1 belong to the draw
        x.texImage2D(x.TEXTURE_2D, 0, x.RGBA, x.RGBA, x.UNSIGNED_BYTE, img);
        for (const [p, v] of [[x.TEXTURE_MIN_FILTER, x.LINEAR], [x.TEXTURE_MAG_FILTER, x.LINEAR], [x.TEXTURE_WRAP_S, x.CLAMP_TO_EDGE], [x.TEXTURE_WRAP_T, x.CLAMP_TO_EDGE]]) x.texParameteri(x.TEXTURE_2D, p, v);
        const tx = { t, w: img.naturalWidth, h: img.naturalHeight };
        cache.set(url, tx);
        if (want === url) swap(tx);
        evict();
      };
      img.onerror = () => { loading.delete(url); if (want === url && !cur) fail(); }; // never drawn: the <img> path; otherwise keep the last good frame
      img.src = url;
    };

    const step = (s: Spring, dt: number) => (s === REST ? s : Math.abs(s.x) < 1e-4 && Math.abs(s.v) < 1e-3 ? REST : stepSpring(s, dt));
    const frame = (now: number) => {
      raf = 0;
      const dt = last ? (now - last) / 1000 : 0;
      last = now; t += Math.min(dt, 0.1);
      squash = step(squash, dt); lag = step(lag, dt);
      if (cur) {
        const { pose, empty } = live.current, xb = usesXBands(pose), m = prev === cur ? 1 : clamp((now - fadeAt) / FADE_MS, 0, 1);
        if (m >= 1) prev = cur;
        x.viewport(0, 0, el.width, el.height); x.clear(x.COLOR_BUFFER_BIT);
        x.activeTexture(x.TEXTURE0); x.bindTexture(x.TEXTURE_2D, prev!.t);
        x.activeTexture(x.TEXTURE1); x.bindTexture(x.TEXTURE_2D, cur.t);
        x.uniform1f(U.u_mix, m);
        x.uniform4f(U.u_rect, rect[0], rect[1], rect[2], rect[3]);
        x.uniform1f(U.u_sway, empty ? 0 : Math.sin((2 * Math.PI * t) / WARP.swayPeriod)); // empty slime: breathing only
        x.uniform1f(U.u_breathe, Math.sin((2 * Math.PI * t) / WARP.breathePeriod));
        x.uniform1f(U.u_drag, clamp(lag.x, -WARP.dragMax, WARP.dragMax));
        x.uniform1f(U.u_squash, clamp(squash.x, -WARP.squashMax, WARP.squashMax));
        if (xb) { x.uniform3f(U.u_head, WARP.xHead, 1, 1); x.uniform3f(U.u_chest, WARP.xChest.from, WARP.xChest.to, WARP.xBandAmp); }
        else { x.uniform3f(U.u_head, WARP.head.edge, 0, 0); x.uniform3f(U.u_chest, WARP.chest.from, WARP.chest.to, 1); }
        x.drawElements(x.TRIANGLES, nIdx, x.UNSIGNED_SHORT, 0);
        if (first) { first = false; setDrawn(true); }
      }
      go();
    };
    const on = () => !dead && seen && document.visibilityState === "visible";
    function go() { if (!raf && on()) raf = requestAnimationFrame(frame); }
    function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
    const onVis = () => (on() ? go() : stop());

    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; onVis(); });
    const ro = new ResizeObserver(([e]) => {
      const d = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      w = Math.max(1, e.contentRect.width); h = Math.max(1, e.contentRect.height);
      el.width = Math.round(w * d); el.height = Math.round(h * d);
      fit(); go();
    });
    const lost = (e: Event) => { e.preventDefault(); fail(); };
    io.observe(el); ro.observe(el);
    el.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", onVis);
    g.current = { show, kick: (i) => { squash = kick(squash, i); go(); }, drag: (vx) => { lag = { x: clamp(vx, -1, 1), v: lag.v }; go(); } };
    show(srcRef.current);
    return () => {
      dead = true; stop(); g.current = null;
      io.disconnect(); ro.disconnect();
      el.removeEventListener("webglcontextlost", lost); document.removeEventListener("visibilitychange", onVis);
      for (const v of cache.values()) x.deleteTexture(v.t);
    };
  }, [gl]);

  useEffect(() => { g.current?.show(src); }, [src]);
  useEffect(() => { if (!gl) setDrawn(false); }, [gl]);

  const fill = "absolute inset-0 h-full w-full object-contain object-bottom";
  return (
    <div role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={`relative ${className}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {(!gl || !drawn) && <img src={src} alt="" draggable={false} className={fill} />}
      {gl && <canvas ref={canvas} className="absolute" style={bleed ? { left: `${-PAD.x * 100}%`, top: `${-PAD.top * 100}%`, width: `${(1 + 2 * PAD.x) * 100}%`, height: `${(1 + PAD.top) * 100}%` } : { inset: 0, width: "100%", height: "100%" }} />}
    </div>
  );
}

/** One ClipPlayer per character instance. play(kind, base key, that sprite's clips) / stop(kind); show() = the running clip's base key + frame, or null = show the still.
 *  A clip stays on the base it started from (a reaction that also swaps the expression plays out, then lands on the new still). Frames step on a timeout, not rAF. */
export function useClip(empty: boolean) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [c] = useState(() => {
    let st = ClipPlayer.init({}, empty), base: string | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      const cur = st.cur, info = cur && st.clips[cur.kind];
      if (!cur || !info) return;
      if (ClipPlayer.tick(st, performance.now()).kind === null) { st = { ...st, cur: null }; return; } // one-shot done
      const per = 1000 / info.fps;
      timer = setTimeout(() => { run(); bump(); }, per - ((performance.now() - cur.start) % per) + 1);
    };
    return {
      play(kind: ClipKind, key: string | null, clips: Manifest["clips"]) {
        if (!key) return;
        const now = performance.now();
        if (key !== base) {
          if (ClipPlayer.tick(st, now).kind === "talk" && kind !== "talk") return; // talk outranks everything
          st = ClipPlayer.init(clips, st.empty); base = key;
        } else st = { ...st, clips };
        const next = ClipPlayer.play(st, kind, now);
        if (next === st) return;
        st = next; run(); bump();
      },
      stop(kind: ClipKind) { const next = ClipPlayer.stop(st, kind); if (next !== st) { st = next; clearTimeout(timer); bump(); } },
      empty(e: boolean) { if (e !== st.empty) { clearTimeout(timer); st = ClipPlayer.init({}, e); base = null; } },
      show(): { key: string; kind: ClipKind; frame: number } | null {
        const t = ClipPlayer.tick(st, performance.now());
        return t.kind && base ? { key: base, kind: t.kind, frame: t.frame! } : null;
      },
      dispose() { clearTimeout(timer); },
    };
  });
  c.empty(empty);
  useEffect(() => () => c.dispose(), [c]);
  return c;
}
