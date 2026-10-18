"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hopPath, WARP } from "@/lib/mascot/anim";
import type { Expression } from "@/lib/mascot/core";
import { clipsFor, clipUrl, clipUrls, reactionFor, type Clips, type ReactEvent } from "@/lib/mascot/play";
import { POSE_SPEC, stageSprite, type Pose } from "@/lib/mascot/poses";
import {
  blinkSchedule, chooseSpot, classifyBodyGesture, idleMood, LONGPRESS_MS, nextMoveDelay, onScreen, rectsIntersect, refitSpot, settleSpot, spotBox, TAP_MAX_MOVE,
  type PointerSample, type Rect, type Spot, type StageEvent,
} from "@/lib/mascot/stage";
import type { Boldness, Library } from "@/lib/sprites/core";
import { init, step, type Act, type Ev } from "@/lib/sprites/behaviour";
import { ClipPortrait } from "./ClipPortrait";
import { SpriteCanvas, useClip, type SpriteHandle } from "./SpriteCanvas";

export const FIELD = "textarea, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=file],[type=color])";
export const isTyping = () => !!(document.activeElement as HTMLElement | null)?.matches?.(FIELD);

const SIZE_VH = { s: 0.35, m: 0.45, l: 0.55 }; // standing height
const MOVE = "transform 900ms cubic-bezier(.34,1.25,.64,1), opacity 300ms";
const SETTLE = "transform 420ms cubic-bezier(.34,1.4,.64,1)";
const BOUNCE = "transform 700ms cubic-bezier(.34,1.9,.64,1)"; // overshoot = bounce off the edge
const BLINK_MS = 180; // sleepy-sprite stand-in blink hold (matches the blink clip's ~180 ms)
const HOP = "opacity 300ms"; // moves hop via WAAPI keyframes (hopPath); the CSS transition only fades
const HOP_MS = 300; // per hop
const KICK = { poke: 2.5, pat: 1, drop: 3, land: 2 }; // squash impulses
const DRAG_PX_MS = 1.5; // pointer speed that maxes the hair lag
const EXIT_MS = 350;
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const any = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = {
  sprites: Record<string, number>; clips: Clips | null; outfit: string; expression: Expression | null; size: "s" | "m" | "l"; mischief: number;
  empty: boolean; hushed: boolean; typing: boolean; hidden: boolean;
  /** RP tab open: idle spots prefer peek/lean. */
  spy?: boolean;
  /** Changes when a [data-composer] shows/hides/resizes: re-check she isn't covering one. */
  layout: string;
  menuOpen: boolean; overlay: ReactNode; label: string;
  /** Sprites-studio clip library + boldness: with an approved Stage idle for the outfit, the behaviour engine drives her; otherwise the legacy poses. */
  lib: Library | null; boldness: Boldness; onQuip: (quip: NonNullable<Act["quip"]>) => void;
  onMenu: () => void; onCloseMenu: () => void; onPoke: () => void; onSwipeOff: () => void;
};
type Press = { samples: PointerSample[]; left: number; top: number; long: boolean; dragging: boolean; timer?: ReturnType<typeof setTimeout> };

/** Full-body Miyabi: roams the viewport (stage brain in lib/mascot/stage), reacts to touch. Transform/opacity animation only. */
export function Stage(p: Props) {
  const { sprites, outfit, mischief, hidden, typing, lib } = p;
  const startPose = lib?.clips.find((c) => c.surface === "stage" && c.outfit === outfit && c.from === c.to && c.from === "stand")?.from ?? lib?.clips.find((c) => c.surface === "stage" && c.outfit === outfit && c.from === c.to)?.from ?? null;
  const eng = startPose !== null; // an approved Stage idle exists for this outfit
  const [bpose, setBpose] = useState(startPose ?? "stand");
  const bs = useRef(init(bpose, Date.now(), Math.random));
  const have = useMemo(() => new Set(Object.keys(sprites)), [sprites]);
  // stableH sizes her: the tallest innerHeight seen at this width, so keyboards/toolbars don't make her grow and shrink (reset on rotate).
  const [view, setView] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight, stableH: window.innerHeight }));
  const [spot, setSpot] = useState<Spot | null>(null);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [gone, setGone] = useState<{ left: number; top: number } | null>(null); // swiped off, sliding out
  const [motion, setMotion] = useState(MOVE);
  const [reaction, setReaction] = useState<{ e: Expression; ms: number } | null>(null);
  const [mood, setMood] = useState<Expression>("smug");
  const [blink, setBlink] = useState(false);
  const press = useRef<Press | null>(null);
  const lastTap = useRef<number | null>(null);
  const inner = useRef<HTMLDivElement>(null);
  const sway = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<SpriteHandle>(null);
  const hop = useRef<Animation | null>(null);
  const prevHome = useRef<{ x: number; y: number } | null>(null);
  const blinkOff = useRef<ReturnType<typeof setTimeout>>(undefined);
  const exit = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { vw, vh } = view, baseH = view.stableH * SIZE_VH[p.size];
  const dims = (pose: Pose) => { const sp = POSE_SPEC[pose], h = baseH * (sp.height / 1216); return { w: (h * sp.width) / sp.height, h }; };
  const fits = (pose: Pose) => eng || stageSprite(have, pose, outfit, "smug") !== null;
  /** Measured only when choosing a spot: composers, the island and a focused field are off limits; [data-mascot-target] cards are fair game. */
  const collect = () => {
    const q = (s: string) => [...document.querySelectorAll(s)].map(rectOf);
    const f = document.activeElement;
    return { vw, vh, baseH, rand: Math.random, avoid: onScreen([...q("[data-composer], [data-island]"), ...(f?.matches?.(FIELD) ? [rectOf(f)] : [])], vw, vh), targets: onScreen(q("[data-mascot-target]"), vw, vh) };
  };
  function move(event?: StageEvent) {
    const ctx = { ...collect(), mischief, event, prefer: p.spy && mischief > 0 ? (["peek", "lean"] as Pose[]) : undefined, from: spot ? { x: spot.x, y: spot.y } : undefined };
    let s = chooseSpot(ctx);
    for (let i = 0; i < 12 && !fits(s.pose); i++) s = chooseSpot(ctx);
    if (!fits(s.pose)) s = chooseSpot({ ...ctx, mischief: 0 }); // stand/peek: always drawable (stand exists)
    if (act.current.eng) s = { ...s, pose: "stand" }; // engine poses are clips in one box; position logic only
    setMotion(reduced() ? MOVE : HOP); setGone(null); setSpot(s); setMood(idleMood(Math.random, event === "bored"));
  }
  // Latest closures for long-lived listeners.
  const act = useRef({ eng, run: (_ev: Ev) => {}, move, spot, collect, mischief, hidden, typing, baseH, react: (_ev: ReactEvent, _mood?: Expression) => {}, blink: () => {} });
  act.current = { ...act.current, eng, move, spot, collect, mischief, hidden, typing, baseH };
  /** Resize: stay put unless she drifted off-screen (nudge back) or now covers an avoid rect (re-pick). */
  const refit = () => {
    const a = act.current, s = a.spot;
    if (!s || a.hidden) return;
    const c = a.collect(), t = refitSpot(s, a.baseH, c.vw, c.vh, c.avoid);
    if (!t) a.move(a.typing ? "typing" : undefined);
    else if (t !== s) { setMotion(SETTLE); setSpot(t); }
  };

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      setView((v) => ({ vw, vh, stableH: vw === v.vw ? Math.max(v.stableH, vh) : vh }));
      clearTimeout(t); t = setTimeout(refit, 250);
    };
    const onStage = (e: Event) => { if (!act.current.hidden) act.current.move((e as CustomEvent<StageEvent>).detail); };
    const onBus = (e: Event) => {
      const a = act.current, k = (e as CustomEvent<{ kind: string }>).detail?.kind;
      if (a.hidden) return;
      if (k === "idle" && a.mischief > 0 && !a.typing) a.move("bored"); // mischief 0 = parked
      else if ((k === "generated" || k === "upscaled" || k === "error") && a.spot?.pose === "back") { setMotion(MOVE); setSpot({ ...a.spot, pose: "stand" }); } // turn round to judge it
      else if (k === "generated" || k === "upscaled") a.react(k);
    };
    const onReact = (e: Event) => { const d = (e as CustomEvent<{ profile: string; event: ReactEvent }>).detail; if (d?.profile === "miyabi" && !act.current.hidden) act.current.react(d.event); };
    const release = () => { const pr = press.current; if (!pr) return; press.current = null; clearTimeout(pr.timer); setDrag(null); setMotion(MOVE); };
    // Scroll: a small sway, rAF-throttled, written straight to the style (no render).
    const last = new WeakMap<object, number>();
    let raf = 0, dir = 1, still: ReturnType<typeof setTimeout>;
    const onScroll = (e: Event) => {
      const el = (e.target === document ? document.documentElement : e.target) as Element;
      const y = el.scrollTop ?? 0;
      dir = Math.sign(y - (last.get(el) ?? y)) || dir; last.set(el, y);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (sway.current) sway.current.style.rotate = `${dir * 3}deg`;
        clearTimeout(still); still = setTimeout(() => { if (sway.current) sway.current.style.rotate = ""; }, 160);
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("mascot:stage", onStage);
    window.addEventListener("mascot", onBus);
    window.addEventListener("mascot:react", onReact);
    window.addEventListener("blur", release);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      clearTimeout(t); clearTimeout(still); clearTimeout(exit.current); cancelAnimationFrame(raf); clearTimeout(press.current?.timer);
      window.removeEventListener("resize", onResize); window.removeEventListener("mascot:stage", onStage); window.removeEventListener("mascot", onBus); window.removeEventListener("mascot:react", onReact);
      window.removeEventListener("blur", release); document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);

  // Behaviour engine: Web sends tick / poke / typing only (drag, drop, sys* are Mac-only).
  act.current.run = (ev) => {
    if (!lib) return;
    const r = step(bs.current, ev, { lib, outfit, boldness: p.boldness, now: Date.now(), rand: Math.random });
    bs.current = r.s;
    if (r.act) { setBpose(r.act.pose); if (r.act.quip) p.onQuip(r.act.quip); }
  };
  useEffect(() => { if (startPose) { bs.current = init(startPose, Date.now(), Math.random); setBpose(startPose); } }, [outfit, startPose === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!eng || hidden) return;
    const t = setInterval(() => { if (!document.hidden) act.current.run({ type: "tick" }); }, 1000); // paused while the tab is hidden
    return () => clearInterval(t);
  }, [eng, hidden]);
  useEffect(() => { if (eng && typing && !hidden) act.current.run({ type: "typing" }); }, [typing]); // eslint-disable-line react-hooks/exhaustive-deps
  // On stage at mount and on summon; hiding drops any gesture in progress.
  useEffect(() => {
    if (!hidden) { act.current.move(); return; }
    prevHome.current = null; // a summon appears at her new spot instead of hopping in from the old one
    clearTimeout(press.current?.timer); press.current = null; setDrag(null);
  }, [hidden]);
  // Mischief dialled to 0: park at an edge now.
  useEffect(() => { if (mischief === 0 && act.current.spot && !act.current.hidden) act.current.move(); }, [mischief]);
  // Outfit/sprites changed under her: redraw-able pose or move.
  useEffect(() => { const s = act.current.spot; if (s && !fits(s.pose)) act.current.move(); }, [outfit, have]); // eslint-disable-line react-hooks/exhaustive-deps
  // Typing: duck to the nearest edge.
  useEffect(() => { if (typing && !act.current.hidden) act.current.move("typing"); }, [typing]);
  // A composer appeared/resized under her: get off it.
  useEffect(() => {
    const a = act.current, s = a.spot;
    if (!s || a.hidden) return;
    const c = a.collect();
    if (c.avoid.some((r) => rectsIntersect(spotBox(s, a.baseH, c.vw, c.vh), r))) a.move(a.typing ? "typing" : undefined);
  }, [p.layout]);
  // Behaviour loop: wander every 20-90 s (scaled by mischief; never at 0).
  useEffect(() => {
    if (hidden || typing || drag || !spot) return;
    const d = nextMoveDelay(mischief, Math.random);
    if (!Number.isFinite(d)) return;
    const t = setTimeout(() => act.current.move(), d);
    return () => clearTimeout(t);
  }, [spot, mischief, hidden, typing, !!drag]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => setReaction(null), reaction.ms);
    return () => clearTimeout(t);
  }, [reaction]);

  const expr: Expression = drag ? "shocked" : reaction?.e ?? p.expression ?? mood;
  const key = spot && (eng ? "engine" : stageSprite(have, spot.pose, outfit, expr));
  const clip = useClip(p.empty);
  const clips = useMemo(() => clipsFor(p.clips, eng ? null : key), [p.clips, key, eng]);
  const sleepy = spot && !eng && !p.empty && spot.pose !== "back" ? stageSprite(have, spot.pose, outfit, "sleepy") : null;
  const sleepyBlink = !clips.blink && !!sleepy && sleepy.endsWith("/sleepy") && sleepy !== key; // no blink clip: flash the sleepy sprite
  const canBlink = !hidden && !p.empty && spot?.pose !== "back" && (!!clips.blink || sleepyBlink);
  act.current.react = (ev, m = expr) => { const k = reactionFor(ev, m, Math.random); if (clips[k] && !reduced()) clip.play(k, key, clips); };
  act.current.blink = () => { if (clips.blink) clip.play("blink", key, clips); else { setBlink(true); clearTimeout(blinkOff.current); blinkOff.current = setTimeout(() => setBlink(false), BLINK_MS); } };
  useEffect(() => {
    if (!canBlink) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(() => { act.current.blink(); loop(); }, blinkSchedule(Math.random)); };
    loop();
    return () => { clearTimeout(t); clearTimeout(blinkOff.current); setBlink(false); };
  }, [canBlink]);
  // This sprite's clip frames (and the blink stand-in) into the HTTP cache, so swaps don't wait on the network.
  useEffect(() => { for (const u of [...clipUrls(p.clips, key), ...(sleepyBlink ? [`/api/mascot/sprites/${sleepy}?v=${sprites[sleepy!]}`] : [])]) new Image().src = u; }, [p.clips, key, sleepyBlink]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moves hop: keyframed transforms along hopPath from the last home to the new one, squash on landing. Fewer than 2 points = snap.
  const home = spot && (() => { const { w, h } = dims(spot.pose); return { x: spot.x - w / 2, y: spot.y - h }; })();
  useLayoutEffect(() => {
    const from = prevHome.current;
    prevHome.current = home;
    hop.current?.cancel(); hop.current = null; // any spot change ends a running hop (a stale one would land her at the old spot)
    if (!home || !from || motion !== HOP || !box.current || (from.x === home.x && from.y === home.y)) return;
    const path = hopPath(from, home);
    if (path.length < 2) return;
    hop.current = box.current.animate(path.map((k) => ({
      offset: k.t, easing: k.squash < 0 ? "ease-in" : "ease-out", // rise slows into the apex, fall speeds into the landing
      transform: `translate(${k.x}px, ${k.y}px) rotate(${k.tilt}rad) scale(${1 + k.squash * WARP.squashShift}, ${1 - k.squash})`,
    })), { duration: ((path.length - 1) / 2) * HOP_MS });
    hop.current.onfinish = () => { hop.current = null; canvas.current?.kick(KICK.land); };
  }, [home?.x, home?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!spot || !home) return null;
  const { w, h } = dims(spot.pose);
  const homeL = home.x, homeT = home.y;
  const left = drag?.left ?? gone?.left ?? homeL, top = drag?.top ?? gone?.top ?? homeT;

  /** Squash on the live canvas; no canvas (fallback <img>) → the old CSS jiggle for poke/pat. */
  function squish(kind: keyof typeof KICK) {
    if (reduced() || canvas.current?.kick(KICK[kind])) return;
    if (kind === "poke" || kind === "pat") jiggle(kind);
  }
  function jiggle(kind: "poke" | "pat") {
    inner.current?.animate(kind === "pat"
      ? [{ transform: "none" }, { transform: "scale(1.03,.97)" }, { transform: "scale(.99,1.02)" }, { transform: "none" }]
      : [{ transform: "none" }, { transform: "scale(1.1,.88)" }, { transform: "scale(.94,1.06)" }, { transform: "scale(1.02,.98)" }, { transform: "none" }],
    { duration: kind === "pat" ? 600 : 420, easing: "ease-out" });
  }
  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button > 0) return; // right click → context menu
    e.currentTarget.setPointerCapture(e.pointerId);
    hop.current?.cancel(); hop.current = null; // mid-hop: the hop ends, she is grabbed at her new spot
    const pr: Press = { samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], left: homeL, top: homeT, long: false, dragging: false };
    pr.timer = setTimeout(() => { if (press.current === pr && !pr.dragging) { pr.long = true; p.onMenu(); } }, LONGPRESS_MS);
    press.current = pr;
  }
  function moveP(e: React.PointerEvent) {
    const pr = press.current;
    if (!pr || pr.long) return;
    const a = pr.samples[0];
    pr.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (!pr.dragging && Math.hypot(e.clientX - a.x, e.clientY - a.y) > TAP_MAX_MOVE) { pr.dragging = true; clearTimeout(pr.timer); p.onCloseMenu(); }
    if (pr.dragging) {
      setDrag({ left: pr.left + e.clientX - a.x, top: pr.top + e.clientY - a.y });
      const q = pr.samples[pr.samples.length - 2], v = (e.clientX - q.x) / Math.max(1, e.timeStamp - q.t) / DRAG_PX_MS;
      canvas.current?.drag(spot!.flip ? -v : v); // sprite space: a flipped sprite lags the other way
    }
  }
  function up(e: React.PointerEvent) {
    const pr = press.current; press.current = null;
    if (!pr) return;
    clearTimeout(pr.timer);
    if (pr.long) return;
    pr.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    const g = classifyBodyGesture(pr.samples, { box: { x: pr.left, y: pr.top, w, h }, vw, vh, lastTapAt: lastTap.current });
    const a = pr.samples[0], z = pr.samples[pr.samples.length - 1], b = pr.samples[Math.max(0, pr.samples.length - 4)];
    const dl = pr.left + z.x - a.x, dt = pr.top + z.y - a.y; // where her box is now
    lastTap.current = g === "menu" || g === "pat" || g === "poke" ? e.timeStamp : null;
    setDrag(null);
    if (g === "menu" || g === "longpress") p.onMenu();
    else if (g === "pat") { const r = any<Expression>(["flirty", "laughing"]); act.current.react("pat"); if (eng) act.current.run({ type: "poke" }); setReaction({ e: r, ms: 1800 }); squish("pat"); }
    else if (g === "poke") {
      const r = any<Expression>(["shocked", "annoyed", "laughing"]);
      p.onCloseMenu(); act.current.react("poke", r); setReaction({ e: r, ms: 1500 }); squish("poke");
      if (eng) act.current.run({ type: "poke" }); else p.onPoke();
    } else if (g === "drag") { setMotion(SETTLE); setSpot(settleSpot({ x: dl + w / 2, y: dt + h }, collect(), fits)); act.current.react("drop"); squish("drop"); }
    else if (g === "flick") {
      const right = z.x + (z.x - b.x) * 4 >= vw / 2;
      setMotion(BOUNCE); setSpot(settleSpot({ x: right ? vw : 0, y: dt + h }, collect(), (q) => q === "stand"));
      act.current.react("flick"); squish("drop");
      setReaction({ e: "annoyed", ms: 5000 }); // sulks; the behaviour loop creeps her back later
    } else if (g === "swipeOff") {
      const dx = z.x - b.x, dy = z.y - b.y, n = Math.hypot(dx, dy) || 1, k = Math.max(vw, vh);
      setMotion(`transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms`);
      setGone({ left: dl + (dx / n) * k, top: dt + (dy / n) * k });
      clearTimeout(exit.current); exit.current = setTimeout(p.onSwipeOff, EXIT_MS);
    }
  }
  /** Stuck-gesture guard: cancel / lost capture / blur all drop her back where she was. */
  function release() { const pr = press.current; if (!pr) return; press.current = null; clearTimeout(pr.timer); setDrag(null); setMotion(MOVE); }

  // Speech bubble / carousel: above her head (below it when she's near the top), clamped on-screen.
  const ow = Math.min(288, vw - 16), above = homeT > 140;
  const overlay = (
    <div className="pointer-events-auto absolute flex justify-center" aria-live="polite"
      style={{ left: Math.min(vw - ow - 8, Math.max(8, spot.x - ow / 2)), top: above ? homeT : homeT + h * 0.3, width: ow, transform: above ? "translateY(calc(-100% - 4px))" : undefined }}>
      {!drag && !typing && p.overlay}
    </div>
  );
  const flip = spot.flip ? "scaleX(-1)" : undefined;
  const src = (k: string) => `/api/mascot/sprites/${k}?v=${sprites[k]}`;
  const playing = clip.show();
  const frame = eng ? "" : (playing && clipUrl(p.clips, playing.key, playing.kind, playing.frame)) || src(blink && sleepyBlink ? sleepy! : key!);

  return (
    <div data-noswipe className="pointer-events-none fixed inset-0 z-30 overflow-hidden select-none">
      {p.menuOpen && <button type="button" tabIndex={-1} aria-label="Close menu" className="pointer-events-auto fixed inset-0 cursor-default" onClick={p.onCloseMenu} />}
      {!hidden && key && (
        <div ref={box} role="button" tabIndex={0} aria-label={p.label} aria-expanded={p.menuOpen}
          onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={release} onLostPointerCapture={release}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onMenu(); } else if (e.key === "Escape") p.onCloseMenu(); }}
          onContextMenu={(e) => { e.preventDefault(); p.onMenu(); }}
          className={`absolute top-0 left-0 cursor-grab ${typing ? "pointer-events-none opacity-50" : "pointer-events-auto"}`}
          style={{ width: w, height: h, transform: `translate(${left}px, ${top}px)`, transformOrigin: "50% 100%", transition: drag ? "none" : motion, opacity: gone ? 0 : undefined, touchAction: "none", WebkitTouchCallout: "none" }}>
          <div ref={sway} className="mascot-bob h-full w-full origin-bottom" style={{ transition: "rotate 300ms var(--ease-out)" }}>
            <div ref={inner} className={`relative h-full w-full origin-bottom transition-[filter,opacity] duration-500 ${drag ? "mascot-flail" : ""} ${p.empty ? "opacity-70" : ""}`}>
              {/* contact shadow: a static gradient, no filter (a filter on the repainting canvas would cost every frame) */}
              <div aria-hidden="true" className="absolute -bottom-[1.5%] left-1/2 h-[4%] w-[55%] -translate-x-1/2" style={{ background: "radial-gradient(closest-side, rgb(0 0 0 / 0.22), transparent)" }} />
              {eng && lib ? <ClipPortrait key={outfit} surface="stage" lib={lib} outfit={outfit} expression={bpose} className="h-full w-full" />
                : <SpriteCanvas ref={canvas} src={frame} cut={playing?.kind === "blink" || (blink && sleepyBlink)} pose={spot.pose} empty={p.empty} bleed className="h-full w-full" style={{ transform: flip }} />}
              {p.hushed && <span aria-hidden="true" className="text-muted absolute top-[6%] right-[22%] font-mono text-xs">zzz</span>}
            </div>
          </div>
        </div>
      )}
      {overlay}
    </div>
  );
}
