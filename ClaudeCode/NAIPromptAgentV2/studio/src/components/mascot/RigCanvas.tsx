"use client";
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import type { Spring } from "@/lib/mascot/anim";
import { cancelThink, cancelWave, hairMask, handMask, idleUniforms, newThink, newWave, spring, startThink, startWave, stopThink, thinkStep, queuedWave, waveReady, walkBob, walkSettle, walkSway, WAVE_QUEUE_S, walkFrame, waveStep, type Quirks, type Rig } from "@/lib/mascot/rig";
import type { SpriteHandle } from "./SpriteCanvas";

export type RigHandle = SpriteHandle & { wave(hold?: boolean): void; walk(on: boolean): boolean; think(on: boolean): boolean };
type Props = { rig: Rig; className?: string; style?: CSSProperties; ref?: Ref<RigHandle> };

const DOT: [number, number] = [525, 140], DPR_MAX = 2, IDLE: (keyof Quirks)[] = ["ear", "tilt", "flick", "sway", "ear"];
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0, 1); }`;
// Inverse warp: for each screen pixel find where it came from in the still. All coords in still pixels.
const fs = (w: number, h: number) => `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D img, img2, hmask, hairm;
uniform float mixT, hA;
uniform vec2 hP;
uniform float breath, dip, sway, tilt, earL, earR, hair, blink;
const vec2 SZ = vec2(${w}., ${h}.);
vec2 rot(vec2 p, vec2 piv, float a) { float c = cos(a), s = sin(a); p -= piv; return piv + vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
void main() {
  vec2 p = uv * SZ, q = p;
  // ears: rotate about their bases, only above the base
  float wl = smoothstep(150., 90., q.y) * smoothstep(420., 395., q.x);
  q = mix(q, rot(q, vec2(372., 150.), -earL), wl);
  float wr = smoothstep(165., 110., q.y) * smoothstep(400., 425., q.x);
  q = mix(q, rot(q, vec2(450., 160.), earR), wr);
  // head tilt about the neck: a soft oval over head and ears, so shoulders and arms stay put
  float wh = smoothstep(1.25, .95, length((q - vec2(395., 185.)) / vec2(140., 175.)));
  q = mix(q, rot(q, vec2(405., 300.), -tilt), wh);
  // breathing lifts the chest only; the arm hangs outside the oval
  q.y += breath * 3. * smoothstep(1., .5, length((q - vec2(400., 420.)) / vec2(100., 130.)));
  // weight shift: the upper body rocks rigidly about the hips, legs and skirt hem stay straight
  q = mix(q, rot(q, vec2(380., 700.), -sway * .012), smoothstep(760., 640., q.y));
  // knee dip: everything above the knees drops together, the shins take the squash, feet planted
  q.y += dip * 8. * smoothstep(1150., 900., q.y);
  // hanging hair on her left swings more toward the tips; only hair pixels move and only onto hair or empty space
  float wy = smoothstep(260., 950., q.y), hm = texture(hairm, q / SZ).r;
  vec2 qs = q - vec2(hair * 6. * wy * wy, 0.);
  q = mix(q, qs, hm * texture(hairm, qs / SZ).r);
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
function drawFx(fc: CanvasRenderingContext2D, parts: Part[], k: number, dt: number, dots: number) {
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
  // thought dots rise up and away from her face, a little bigger each
  for (let i = 0; i < dots; i++) {
    fc.setTransform(k, 0, 0, k, (DOT[0] + i * 18) * k, (DOT[1] - i * 14) * k);
    fc.beginPath(); fc.arc(0, 0, 5 + i, 0, 2 * Math.PI);
    fc.fillStyle = "rgba(255,255,255,.92)"; fc.shadowColor = "#e6d6ff"; fc.shadowBlur = 6; fc.fill(); fc.shadowBlur = 0; fc.lineWidth = 1.5; fc.strokeStyle = "#b9a0e8"; fc.stroke();
  }
}

/** Live rig over one exact still: a WebGL2 inverse-warp shader (breath, sway, head tilt, ears, hair, blink, random quirks) plus the cute wave,
 *  a cut-out hand swung on a spring with hearts popping off the fingertips. Nothing is redrawn, so the line art never blurs.
 *  Reduced motion, no WebGL2 or a lost context → the plain rest still. The still fills the box: give it the rig's aspect. */
export function RigCanvas({ rig, className = "", style, ref }: Props) {
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), fx = useRef<HTMLCanvasElement>(null);
  const g = useRef<{ kick(i: number): void; drag(vx: number): void; wave(hold?: boolean): void; walk(on: boolean): boolean; think(on: boolean): boolean } | null>(null);
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
    wave: (hold) => g.current?.wave(hold),
    walk: (on) => g.current?.walk(on) ?? false,
    think: (on) => g.current?.think(on) ?? false,
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
    const uni = Object.fromEntries(["mixT", "hA", "hP", "breath", "dip", "sway", "tilt", "earL", "earR", "hair", "blink"].map((n) => [n, U(n)]));
    x.uniform1i(U("img"), 0); x.uniform1i(U("img2"), 1); x.uniform1i(U("hmask"), 2); x.uniform1i(U("hairm"), 3);
    x.uniform2f(uni.hP, ...rig.P);

    const upload = (unit: number, set: () => void) => {
      const t = x.createTexture()!; texs.push(t);
      x.activeTexture(x.TEXTURE0 + unit); x.bindTexture(x.TEXTURE_2D, t); set();
      x.texParameteri(x.TEXTURE_2D, x.TEXTURE_WRAP_S, x.CLAMP_TO_EDGE); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_WRAP_T, x.CLAMP_TO_EDGE);
      return t;
    };
    const bind = (unit: number, t: WebGLTexture | null) => { x.activeTexture(x.TEXTURE0 + unit); x.bindTexture(x.TEXTURE_2D, t); };
    const r8 = (unit: number, w: number, h: number, m: Uint8Array) => upload(unit, () => { x.pixelStorei(x.UNPACK_ALIGNMENT, 1); x.texImage2D(x.TEXTURE_2D, 0, x.R8, w, h, 0, x.RED, x.UNSIGNED_BYTE, m); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_MIN_FILTER, x.LINEAR); });
    const rgba = (unit: number, im: HTMLImageElement) => upload(unit, () => {
      x.pixelStorei(x.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      x.texImage2D(x.TEXTURE_2D, 0, x.RGBA, x.RGBA, x.UNSIGNED_BYTE, im);
      x.pixelStorei(x.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      x.generateMipmap(x.TEXTURE_2D); x.texParameteri(x.TEXTURE_2D, x.TEXTURE_MIN_FILTER, x.LINEAR_MIPMAP_LINEAR);
    });
    // Empty masks until the stills are in: no wave layer, no hair swing.
    const noMask = r8(2, 1, 1, new Uint8Array(1)); r8(3, 1, 1, new Uint8Array(1));
    const base: (WebGLTexture | null)[] = [null, null];
    let handTex = noMask;
    [rig.rest, rig.wave].forEach((src, unit) => {
      const im = new Image();
      im.onload = () => {
        if (dead) return;
        base[unit] = rgba(unit, im);
        if (im.naturalWidth === W && im.naturalHeight === H) {
          const c2 = new OffscreenCanvas(W, H).getContext("2d")!; c2.drawImage(im, 0, 0);
          const px = c2.getImageData(0, 0, W, H).data;
          if (unit === 0) r8(3, W, H, hairMask(px, rig));
          else {
            const m = handMask(px, rig);
            masked = m.some((v) => v > 0);
            if (masked) handTex = r8(2, W, H, m);
          }
        }
        if (++loaded === 2) go();
      };
      im.onerror = () => { if (dead) return; if (unit === 0) setFailed(true); else if (++loaded === 2) go(); }; // no wave still = idle without the wave; no rest still = nothing to rig
      im.src = src;
    });
    // Walk and think stills load behind the idle and never block it; a missing one just leaves that action off. Unit 4 is scratch.
    const walkTex: (WebGLTexture | null)[] = rig.walk.map(() => null);
    let thinkTex: WebGLTexture | null = null, thinkOk = true;
    [...rig.walk, rig.think].forEach((src, i) => {
      const im = new Image();
      im.onload = () => {
        if (dead) return;
        const t = rgba(4, im);
        if (i < rig.walk.length) walkTex[i] = t; else thinkTex = t;
      };
      if (i === rig.walk.length) im.onerror = () => { thinkOk = false; think.want = false; }; // no pose: don't hold the wander or a wave for it
      im.src = src;
    });

    const wave = newWave(), think = newThink(), q: Quirks = { blink: -Infinity, ear: -Infinity, tilt: -Infinity, flick: -Infinity, sway: -Infinity };
    const bounce: Spring = { x: 0, v: 0 }, lag: Spring = { x: 0, v: 0 }, parts: Part[] = [];
    let walkAt: number | null = null, waveUntil: number | null = null, settle = { at: 0, dip: 0, sway: 0 };
    const now = () => performance.now() / 1000;
    const frame = (ms: number) => {
      const t = ms / 1000, dt = Math.min(Math.max(t - last, 0), 1 / 30);
      last = t;
      const walking = walkAt !== null;
      // think waits for any wave and walk to finish; a cancelled think (walk, hidden tab) resumes here while still wanted
      if (!walking && think.want && think.at === null && wave.at === null && thinkTex) startThink(think, t);
      const th = thinkStep(think, t), thinking = think.at !== null;
      if (waveUntil !== null) {
        const v = queuedWave(waveUntil, t, walking, think);
        if (v !== "keep") { waveUntil = null; if (v === "play" && startWave(wave, t)) q.ear = -Infinity; }
      }
      const w = waveStep(wave, t, dt, rig);
      if (w.earKick) q.ear = t;
      if (w.flick) spawn(parts, w.flick, 1 + +(Math.random() < 0.4));
      if (!walking && t > nextBlink) { q.blink = t; nextBlink = t + 2.5 + Math.random() * 4; }
      if (!walking && t > nextQuirk) { q[IDLE[(Math.random() * IDLE.length) | 0]] = t; nextQuirk = t + 4 + Math.random() * 6; }
      spring(bounce, 0, 3, 0.35, dt); spring(lag, 0, 2, 0.5, dt);
      const u = idleUniforms(t, q, w);
      u.dip -= bounce.x * 5 - walkSettle(settle.dip, t - settle.at); u.sway += walkSettle(settle.sway, t - settle.at); u.hair += lag.x * 1.5;
      if (walking) {
        // the cycle carries the motion: each still is drawn as is, only the step bob and hip roll move it
        for (const k of Object.keys(u) as (keyof typeof u)[]) u[k] = 0;
        u.dip = walkBob(t - walkAt!, walkTex.length); u.sway = walkSway(t - walkAt!, walkTex.length);
      } else if (thinking) {
        // the think still's head and hair don't sit where rest's do, so the rest-placed blink, ear and hair warps fade out with it
        const k = 1 - th.mixT;
        u.blink *= k; u.earL *= k; u.earR *= k; u.hair *= k;
        u.dip += th.bob; u.sway += th.sway; u.tilt += th.tilt;
      }
      for (const [k, v] of Object.entries(u)) x.uniform1f(uni[k], v);
      x.uniform1f(uni.mixT, walking ? 0 : thinking ? th.mixT : w.mixT); x.uniform1f(uni.hA, walking || thinking ? 0 : w.hA);
      bind(0, walking ? walkTex[walkFrame(t - walkAt!, walkTex.length)] : base[0]);
      bind(1, thinking ? thinkTex : base[1]);
      bind(2, thinking ? noMask : handTex);
      x.viewport(0, 0, el.width, el.height);
      x.clearColor(0, 0, 0, 0); x.clear(x.COLOR_BUFFER_BIT);
      x.drawArrays(x.TRIANGLE_STRIP, 0, 4);
      drawFx(fc, parts, fe.width / W, dt, th.dots);
      raf = requestAnimationFrame(frame);
    };
    const go = () => {
      if (dead || raf || loaded < 2 || document.hidden) return;
      last = now();
      raf = requestAnimationFrame((ms) => { frame(ms); setDrawn(true); });
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; cancelWave(wave); cancelThink(think); waveUntil = null; };
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
      wave: (hold = false) => {
        if (!masked || !raf) return;
        const n = now();
        // played once the walk or think is over; a pat's wave goes stale, the done-rendering one (hold) waits it out
        if (!waveReady(walkAt !== null, think)) waveUntil = Math.max(waveUntil ?? -Infinity, hold ? Infinity : n + WAVE_QUEUE_S);
        else if (startWave(wave, n)) q.ear = -Infinity;
      },
      walk: (on) => {
        if (!on) {
          if (walkAt !== null) { const n = now(); settle = { at: n, dip: walkBob(n - walkAt, walkTex.length), sway: walkSway(n - walkAt, walkTex.length) }; walkAt = null; bounce.v += 1; }
          return true;
        }
        if (walkTex.some((t) => !t)) return false;
        if (walkAt === null) walkAt = now();
        cancelWave(wave); cancelThink(think); parts.length = 0; // a queued wave survives the walk
        return true;
      },
      think: (on) => {
        if (!thinkOk) return false;
        if (on) think.want = true; // the frame loop starts it once the still is in and no wave or walk is running
        else stopThink(think, now());
        return true;
      },
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
