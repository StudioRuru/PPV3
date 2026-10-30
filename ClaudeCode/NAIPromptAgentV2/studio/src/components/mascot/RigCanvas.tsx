"use client";
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import type { Spring } from "@/lib/mascot/anim";
import { cancelWave, handMask, idleUniforms, newWave, spring, startWave, waveStep, type Quirks, type Rig } from "@/lib/mascot/rig";
import type { SpriteHandle } from "./SpriteCanvas";

export type RigHandle = SpriteHandle & { wave(): void };
type Props = { rig: Rig; className?: string; style?: CSSProperties; ref?: Ref<RigHandle> };

const DPR_MAX = 2, IDLE: (keyof Quirks)[] = ["ear", "tilt", "flick", "sway", "ear"];
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0, 1); }`;
// Inverse warp: for each screen pixel find where it came from in the still. All coords in still pixels.
const fs = (w: number, h: number) => `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D img, img2, hmask;
uniform float mixT, hA;
uniform vec2 hP;
uniform float breath, sway, tilt, earL, earR, hair, blink;
const vec2 SZ = vec2(${w}., ${h}.);
vec2 rot(vec2 p, vec2 piv, float a) { float c = cos(a), s = sin(a); p -= piv; return piv + vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
void main() {
  vec2 p = uv * SZ, q = p;
  // ears: rotate about their bases, only above the base
  float wl = smoothstep(150., 90., q.y) * smoothstep(420., 395., q.x);
  q = mix(q, rot(q, vec2(372., 150.), -earL), wl);
  float wr = smoothstep(165., 110., q.y) * smoothstep(400., 425., q.x);
  q = mix(q, rot(q, vec2(450., 160.), earR), wr);
  // head tilt about the neck, fading out down the neck
  float wh = smoothstep(340., 270., q.y) * smoothstep(250., 310., q.x);
  q = mix(q, rot(q, vec2(405., 300.), -tilt), wh);
  // upper body: breathing lift + weight shift, feet stay planted
  q.y += breath * 3.5 * smoothstep(660., 300., q.y);
  q.x -= sway * 5. * smoothstep(1250., 350., q.y);
  // hanging hair on her left: swings more toward the tips
  float wy = smoothstep(260., 950., p.y), wx = smoothstep(365., 320., p.x);
  q.x -= hair * 9. * wy * wy * wx;
  // wave: the hand is its own cut-out layer swung rigidly at the wrist; the gap it leaves shows her untouched hair from the rest still
  vec2 qh = rot(q, hP, -hA);
  float mB = texture(hmask, q / SZ).r, mH = texture(hmask, qh / SZ).r;
  vec4 posed = mix(texture(img2, q / SZ), texture(img, q / SZ), mB);
  posed = mix(posed, texture(img2, qh / SZ), mH);
  vec4 col = mix(texture(img, q / SZ), posed, mixT);
  // blink: upper lid sweeps down each eye, revealing skin with a lash line on its edge
  vec2 eyes[2] = vec2[2](vec2(385., 216.), vec2(430., 218.));
  vec2 rad[2] = vec2[2](vec2(22., 14.), vec2(17., 14.));
  for (int i = 0; i < 2; i++) {
    vec2 d = (q - eyes[i]) / rad[i];
    if (dot(d, d) < 1. && blink > 0.) {
      float lid = -1. + 2. * blink;
      if (d.y < lid) col = texture(img, vec2(q.x, eyes[i].y + rad[i].y + 6.) / SZ);
      if (abs(d.y - lid) < .16 && blink > .15) col = vec4(.16, .1, .12, 1);
    }
  }
  o = col;
}`;

type Part = { x: number; y: number; vx: number; vy: number; age: number; life: number; heart: boolean; r: number; s: number };
const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const spawn = (parts: Part[], [x, y]: [number, number], n: number) => {
  for (let i = 0; i < n; i++) parts.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 20, vx: -15 - Math.random() * 25, vy: -45 - Math.random() * 35,
    age: 0, life: 1 + Math.random() * 0.4, heart: Math.random() < 0.55, r: (Math.random() - 0.5) * 0.6, s: 0.8 + Math.random() * 0.5 });
};
function drawFx(fc: CanvasRenderingContext2D, parts: Part[], k: number, dt: number) {
  fc.setTransform(1, 0, 0, 1, 0, 0); fc.clearRect(0, 0, fc.canvas.width, fc.canvas.height);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age > p.life) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.985;
    const u = p.age / p.life, pop = u < 0.18 ? 1 + 1.70158 * (u / 0.18 - 1) ** 3 + 2.70158 * (u / 0.18 - 1) ** 2 : 1; // back-out pop
    fc.setTransform(k * pop * p.s, 0, 0, k * pop * p.s, p.x * k, p.y * k); fc.rotate(p.r + Math.sin(p.age * 5) * 0.15);
    fc.globalAlpha = 1 - sm((u - 0.55) / 0.45);
    fc.beginPath();
    if (p.heart) {
      fc.moveTo(0, 4); fc.bezierCurveTo(-11, -4, -6, -12, 0, -6); fc.bezierCurveTo(6, -12, 11, -4, 0, 4);
      fc.fillStyle = "#ff8fbf"; fc.shadowColor = "#ffc4dd"; fc.shadowBlur = 8; fc.fill(); fc.shadowBlur = 0; fc.lineWidth = 1.4; fc.strokeStyle = "#fff"; fc.stroke();
    } else {
      for (let j = 0; j < 8; j++) { const a = (j * Math.PI) / 4, l = j % 2 ? 2.2 : 9; fc.lineTo(Math.cos(a) * l, Math.sin(a) * l); }
      fc.closePath(); fc.fillStyle = "#fff"; fc.shadowColor = "#ffd1ea"; fc.shadowBlur = 10; fc.fill(); fc.shadowBlur = 0;
    }
  }
  fc.globalAlpha = 1;
}

/** Live rig over one exact still: a WebGL2 inverse-warp shader (breath, sway, head tilt, ears, hair, blink, random quirks) plus the cute wave,
 *  a cut-out hand swung on a spring with hearts popping off the fingertips. Nothing is redrawn, so the line art never blurs.
 *  Reduced motion, no WebGL2 or a lost context → the plain rest still. The still fills the box: give it the rig's aspect. */
export function RigCanvas({ rig, className = "", style, ref }: Props) {
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), fx = useRef<HTMLCanvasElement>(null);
  const g = useRef<{ kick(i: number): void; drag(vx: number): void; wave(): void } | null>(null);
  const live = !reduced && !failed;

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useImperativeHandle(ref, () => ({
    kick: (i) => (g.current ? (g.current.kick(i), true) : false),
    drag: (vx) => g.current?.drag(vx),
    wave: () => g.current?.wave(),
  }), []);

  useEffect(() => {
    const el = canvas.current, fe = fx.current;
    const x = el?.getContext("webgl2", { premultipliedAlpha: true }), fc = fe?.getContext("2d");
    if (!live || !el || !fe) return;
    if (!x || !fc) { setFailed(true); return; }
    const { w: W, h: H } = rig;
    let dead = false, raf = 0, last = 0, loaded = 0, masked = false, nextBlink = 2, nextQuirk = 5;
    const sh = (t: number, s: string) => {
      const o = x.createShader(t)!; x.shaderSource(o, s); x.compileShader(o);
      if (!x.getShaderParameter(o, x.COMPILE_STATUS)) throw new Error(x.getShaderInfoLog(o) ?? "shader");
      return o;
    };
    const pr = x.createProgram()!, buf = x.createBuffer(), texs: WebGLTexture[] = [];
    try {
      x.attachShader(pr, sh(x.VERTEX_SHADER, VS)); x.attachShader(pr, sh(x.FRAGMENT_SHADER, fs(W, H)));
      x.linkProgram(pr);
      if (!x.getProgramParameter(pr, x.LINK_STATUS)) throw new Error(x.getProgramInfoLog(pr) ?? "link");
    } catch (e) { console.warn("[rig]", e); setFailed(true); return; }
    x.useProgram(pr);
    x.bindBuffer(x.ARRAY_BUFFER, buf);
    x.bufferData(x.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), x.STATIC_DRAW);
    x.enableVertexAttribArray(0); x.vertexAttribPointer(0, 2, x.FLOAT, false, 0, 0);
    const U = (n: string) => x.getUniformLocation(pr, n);
    const uni = Object.fromEntries(["mixT", "hA", "hP", "breath", "sway", "tilt", "earL", "earR", "hair", "blink"].map((n) => [n, U(n)]));
    x.uniform1i(U("img"), 0); x.uniform1i(U("img2"), 1); x.uniform1i(U("hmask"), 2);
    x.uniform2f(uni.hP, ...rig.P);

    const upload = (unit: number, set: () => void) => {
      const t = x.createTexture()!; texs.push(t);
      x.activeTexture(x.TEXTURE0 + unit); x.bindTexture(x.TEXTURE_2D, t); set();
      x.texParameteri(x.TEXTURE_2D, x.TEXTURE_WRAP_S, x.CLAMP_TO_EDGE); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_WRAP_T, x.CLAMP_TO_EDGE);
    };
    // Empty mask until the wave still is in: the shader then shows the rest still only.
    upload(2, () => { x.pixelStorei(x.UNPACK_ALIGNMENT, 1); x.texImage2D(x.TEXTURE_2D, 0, x.R8, 1, 1, 0, x.RED, x.UNSIGNED_BYTE, new Uint8Array(1)); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_MIN_FILTER, x.LINEAR); });
    [rig.rest, rig.wave].forEach((src, unit) => {
      const im = new Image();
      im.onload = () => {
        if (dead) return;
        upload(unit, () => {
          x.pixelStorei(x.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          x.texImage2D(x.TEXTURE_2D, 0, x.RGBA, x.RGBA, x.UNSIGNED_BYTE, im);
          x.pixelStorei(x.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          x.generateMipmap(x.TEXTURE_2D); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_MIN_FILTER, x.LINEAR_MIPMAP_LINEAR);
        });
        if (unit === 1 && im.naturalWidth === W && im.naturalHeight === H) {
          const c2 = new OffscreenCanvas(W, H).getContext("2d")!; c2.drawImage(im, 0, 0);
          const m = handMask(c2.getImageData(0, 0, W, H).data, rig);
          masked = m.some((v) => v > 0);
          if (masked) upload(2, () => { x.pixelStorei(x.UNPACK_ALIGNMENT, 1); x.texImage2D(x.TEXTURE_2D, 0, x.R8, W, H, 0, x.RED, x.UNSIGNED_BYTE, m); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_MIN_FILTER, x.LINEAR); });
        }
        if (++loaded === 2) go();
      };
      im.onerror = () => { if (dead) return; if (unit === 0) setFailed(true); else if (++loaded === 2) go(); }; // no wave still = idle without the wave; no rest still = nothing to rig
      im.src = src;
    });

    const wave = newWave(), q: Quirks = { blink: -Infinity, ear: -Infinity, tilt: -Infinity, flick: -Infinity, sway: -Infinity };
    const bounce: Spring = { x: 0, v: 0 }, lag: Spring = { x: 0, v: 0 }, parts: Part[] = [];
    const now = () => performance.now() / 1000;
    const frame = (ms: number) => {
      const t = ms / 1000, dt = Math.min(Math.max(t - last, 0), 1 / 30);
      last = t;
      const w = waveStep(wave, t, dt, rig);
      if (w.earKick) q.ear = t;
      if (w.flick) spawn(parts, w.flick, 1 + +(Math.random() < 0.4));
      if (t > nextBlink) { q.blink = t; nextBlink = t + 2.5 + Math.random() * 4; }
      if (t > nextQuirk) { q[IDLE[(Math.random() * IDLE.length) | 0]] = t; nextQuirk = t + 4 + Math.random() * 6; }
      spring(bounce, 0, 3, 0.35, dt); spring(lag, 0, 2, 0.5, dt);
      const u = idleUniforms(t, q, w);
      u.breath -= bounce.x * 12; u.hair += lag.x * 1.5;
      for (const [k, v] of Object.entries(u)) x.uniform1f(uni[k], v);
      x.uniform1f(uni.mixT, w.mixT); x.uniform1f(uni.hA, w.hA);
      x.viewport(0, 0, el.width, el.height);
      x.clearColor(0, 0, 0, 0); x.clear(x.COLOR_BUFFER_BIT);
      x.drawArrays(x.TRIANGLE_STRIP, 0, 4);
      drawFx(fc, parts, fe.width / W, dt);
      raf = requestAnimationFrame(frame);
    };
    const go = () => {
      if (dead || raf || loaded < 2 || document.hidden) return;
      last = now();
      raf = requestAnimationFrame((ms) => { frame(ms); setDrawn(true); });
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; cancelWave(wave); };
    const onVis = () => (document.hidden ? stop() : go());
    const ro = new ResizeObserver(([e]) => {
      const d = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      const bw = Math.max(1, Math.round(e.contentRect.width * d)), bh = Math.max(1, Math.round(e.contentRect.height * d));
      if (bw !== el.width || bh !== el.height) { el.width = fe.width = bw; el.height = fe.height = bh; }
    });
    // ponytail: a lost context stays on the static still until remount; add SpriteCanvas's canRestore retry if iOS shows it.
    const onLost = (e: Event) => { e.preventDefault(); stop(); setFailed(true); };
    ro.observe(el);
    el.addEventListener("webglcontextlost", onLost);
    document.addEventListener("visibilitychange", onVis);
    g.current = {
      kick: (i) => { bounce.v += i; },
      drag: (vx) => { lag.x = Math.max(-1, Math.min(1, vx)); },
      wave: () => { if (masked && raf && startWave(wave, now())) q.ear = -Infinity; },
    };
    return () => {
      dead = true; stop(); g.current = null; ro.disconnect();
      el.removeEventListener("webglcontextlost", onLost); document.removeEventListener("visibilitychange", onVis);
      if (!x.isContextLost()) { texs.forEach((t) => x.deleteTexture(t)); x.deleteBuffer(buf); x.deleteProgram(pr); }
      // Free the context on a real unmount (Safari caps live contexts); StrictMode's dev re-run reuses the still-attached element.
      queueMicrotask(() => { if (!el.isConnected) x.getExtension("WEBGL_lose_context")?.loseContext(); });
    };
  }, [live, rig]);

  const fill = "pointer-events-none absolute inset-0 h-full w-full";
  return (
    <div aria-hidden className={`relative ${className}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {(!live || !drawn) && <img src={rig.rest} alt="" draggable={false} className={`${fill} object-contain object-bottom drop-shadow-lg`} />}
      {live && <canvas ref={canvas} className={fill} />}
      {live && <canvas ref={fx} className={fill} />}
    </div>
  );
}
