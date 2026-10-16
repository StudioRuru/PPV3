"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { anchorBox, CAL_ZERO, classifyIslandGesture, CORNER, DRAG, dragAmount, dragSize, drawerSize, EXPANDED, hasIsland, LONG_MS, nextState, springEasing, swipeTab, TAP_SLOP, touchRect,
  type Calibration, type IslandEvent, type IslandState, type Size } from "@/lib/mascot/island";
import { requestSeq } from "@/lib/mascot/ui";
import { requestJson } from "@/lib/net";
import { SETTINGS_ICON, TAB_IDS, TABS, type Tab } from "@/lib/tabs";

const SPRING = springEasing();
const PEEK_MS = 3000; // compact shows this long, then melts back into the island
type Wire = { mischief?: number; island?: Calibration };
type Press = { x: number; y: number; t: number; id: number; el: Element; long: boolean; axis: "x" | "y" | null; timer?: ReturnType<typeof setTimeout> };

/** env(safe-area-inset-top) in px (probe element) and the viewport width; null until measured on the client. */
export function useViewport(): { top: number; vw: number } | null {
  const [v, setV] = useState<{ top: number; vw: number } | null>(null);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const m = () => setV((p) => (p && p.top === probe.offsetHeight && p.vw === window.innerWidth ? p : { top: probe.offsetHeight, vw: window.innerWidth }));
    m();
    window.addEventListener("resize", m);
    return () => { window.removeEventListener("resize", m); probe.remove(); };
  }, []);
  return v;
}

const Icon = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

/** Top navigation: a black drawer that melts out of the Dynamic Island (goo filter on two shapes; content drawn on top),
 *  or a plain dark pill on screens without one. Hot zone: tap = compact ↔ expanded, swipe = prev/next tab,
 *  drag down = open, drag up = close, long-press = hide/summon Miyabi. */
export function LiquidIsland({ tab, onTab, onSettings }: { tab: Tab; onTab: (t: Tab) => void; onSettings: () => void }) {
  const view = useViewport();
  const [state, setState] = useState<IslandState>("minimal");
  const [dragging, setDragging] = useState(false);
  const [peek, setPeek] = useState(false); // dragged far enough to show the expanded content
  const [cal, setCal] = useState<Calibration>(CAL_ZERO);
  const [mischief, setMischief] = useState(5);
  const [hidden, setHidden] = useState(false);
  const [shown, setShown] = useState(true); // Miyabi enabled in settings; off = nothing to hide or summon
  const [seq] = useState(requestSeq); // only the newest Mischief response is applied
  const [mood, setMood] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const suppressUntil = useRef(0); // swallow the click that follows a drag / swipe / long-press (a short window, so later keyboard/VoiceOver clicks pass)
  const reduced = useRef(false);
  const go = (e: IslandEvent) => setState((s) => nextState(s, e));

  const island = !!view && hasIsland(view.top);
  const vw = view?.vw ?? 390;
  const a = anchorBox(cal, island, view?.top ?? 0);
  const max: Size = { w: Math.min(EXPANDED.w, vw - 16), h: EXPANDED.h };
  const rest = drawerSize(state, a, vw);
  const label = TABS.find((t) => t.id === tab)?.label ?? "Studio";

  /** Drawer + panel clip to `sz` (imperative: written per pointermove without a React render). */
  function paint(sz: Size, animate: boolean) {
    const d = drawer.current, p = panel.current;
    if (!d || !p) return;
    const spring = animate && !reduced.current;
    d.style.transition = spring ? `width ${SPRING.ms}ms ${SPRING.easing}, height ${SPRING.ms}ms ${SPRING.easing}` : "none";
    d.style.width = `${sz.w}px`; d.style.height = `${sz.h}px`;
    p.style.transition = `opacity 150ms${spring ? `, clip-path ${SPRING.ms}ms ${SPRING.easing}` : ""}`;
    p.style.clipPath = `inset(0 ${(max.w - sz.w) / 2}px ${max.h - sz.h}px round ${CORNER}px)`;
  }
  useLayoutEffect(() => { if (press.current?.axis !== "y") paint(rest, true); }); // every render (cheap; settles any leftover drag size), never mid-drag

  useEffect(() => {
    reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const apply = (s: Wire | undefined) => { if (!s) return; setCal(s.island ?? CAL_ZERO); if (typeof s.mischief === "number") setMischief(s.mischief); };
    requestJson<{ settings: Wire }>("/api/mascot/state").then((r) => r.ok && apply(r.data.settings));
    const onSettings = (e: Event) => apply((e as CustomEvent<Wire>).detail);
    const onHidden = (e: Event) => { const d = (e as CustomEvent<{ hidden: boolean; show?: boolean }>).detail; setHidden(!!d?.hidden); setShown(d?.show !== false); };
    const onMood = (e: Event) => setMood((e as CustomEvent<{ src: string | null }>).detail?.src ?? null);
    window.addEventListener("mascot:settings", onSettings);
    window.addEventListener("mascot:hidden", onHidden);
    window.addEventListener("mascot:mood", onMood);
    return () => { window.removeEventListener("mascot:settings", onSettings); window.removeEventListener("mascot:hidden", onHidden); window.removeEventListener("mascot:mood", onMood); };
  }, []);

  // Page scroll: down melts it back into the island, up peeks the compact strip.
  useEffect(() => {
    let last = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      go(y > last ? "collapse" : "peek");
      last = y;
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // Switching tab peeks (skip the first render).
  const firstTab = useRef(true);
  useEffect(() => { if (firstTab.current) { firstTab.current = false; return; } go("peek"); }, [tab]);

  useEffect(() => {
    if (state !== "compact" || dragging) return;
    const t = setTimeout(() => go("timeout"), PEEK_MS);
    return () => clearTimeout(t);
  }, [state, dragging]);

  // Expanded: a tap outside or Escape closes it (Escape returns focus to the toggle).
  useEffect(() => {
    if (state !== "expanded") return;
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) go("collapse"); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { go("collapse"); toggle.current?.focus(); } };
    window.addEventListener("pointerdown", out, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", out, true); window.removeEventListener("keydown", key); };
  }, [state]);

  function release() {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    setDragging(false); setPeek(false);
    paint(rest, true);
  }
  useEffect(() => {
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  });

  const hideOrSummon = () => window.dispatchEvent(new CustomEvent(hidden ? "mascot:summon" : "mascot:hide"));

  function down(e: React.PointerEvent) {
    if (press.current || e.button !== 0 || (e.target as Element).closest("[data-ctl]")) return;
    const p: Press = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, el: e.target as Element, long: false, axis: null };
    p.timer = setTimeout(() => { p.long = true; hideOrSummon(); }, LONG_MS);
    press.current = p;
  }
  function move(e: React.PointerEvent) {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.long) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.axis) {
      if (Math.hypot(dx, dy) <= TAP_SLOP) return;
      clearTimeout(p.timer);
      p.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      try { p.el.setPointerCapture(e.pointerId); } catch {} // keep the moves when the finger leaves the hot zone (nav itself is pointer-events:none)
      setDragging(true);
    }
    if (p.axis !== "y") return;
    const d = dragAmount(dy);
    paint(dragSize(rest, a, max, d), false);
    setPeek(state !== "expanded" && d > DRAG.content);
  }
  function up(e: React.PointerEvent) {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const g = p.long ? "longpress" : classifyIslandGesture({ dx: e.clientX - p.x, dy: e.clientY - p.y, ms: e.timeStamp - p.t });
    release();
    if (g === "tap") return; // the native click toggles (one path for touch, mouse and keyboard)
    suppressUntil.current = performance.now() + 400;
    if (g === "swipeLeft" || g === "swipeRight") { const t = swipeTab(TAB_IDS, tab, g); if (t) onTab(t); return; }
    if (g === "down" || g === "up") { const next = nextState(state, g === "down" ? "expand" : "collapse"); paint(drawerSize(next, a, vw), true); setState(next); }
  }

  function pick(f: () => void) { go("collapse"); toggle.current?.focus(); f(); }
  async function saveMischief(m: number) {
    setMischief(m);
    const n = seq.start();
    const r = await requestJson<{ settings: Wire }>("/api/mascot/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { mischief: m } }) });
    if (seq.done(n) && r.ok) window.dispatchEvent(new CustomEvent("mascot:settings", { detail: r.data.settings }));
  }

  if (!view) return null;
  const open = state === "expanded" || peek;
  const compact = state === "compact" && !dragging;
  const centre = (x = a.x) => `translateX(calc(-50% + ${x}px))`;
  const hot = touchRect(state, view.top, cal, a, rest); // island phones: a strip below the cutout (iOS never sends touches on the island itself)

  return (
    <nav ref={root} aria-label="Navigation" data-noswipe className="pointer-events-none fixed inset-x-0 top-0 z-[36] h-0 select-none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={release} onLostPointerCapture={release}
      onClickCapture={(e) => { if (performance.now() < suppressUntil.current) { suppressUntil.current = 0; e.preventDefault(); e.stopPropagation(); } }}>
      {/* Goo: blur + alpha threshold fuses the anchor and the drawer. Only these two black shapes are filtered. */}
      {island && (
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <filter id="island-goo" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12" />
          </filter>
        </svg>
      )}
      <div aria-hidden="true" className="absolute left-1/2" style={{ top: 0, width: EXPANDED.w + 80, height: a.top + EXPANDED.h + 40, transform: centre(), filter: island ? "url(#island-goo)" : undefined }}>
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: a.top, width: a.w, height: a.h }} />
        <div ref={drawer} className="absolute left-1/2 -translate-x-1/2 bg-black" style={{ top: a.top, borderRadius: CORNER }} />
      </div>

      {/* Expanded content, clipped to the drawer while it grows. */}
      <div ref={panel} inert={state !== "expanded"} data-island={state === "expanded" || undefined} className={`absolute left-1/2 text-white ${open ? "opacity-100" : "opacity-0"} ${state === "expanded" ? "pointer-events-auto" : ""}`}
        style={{ top: a.top, width: max.w, height: max.h, paddingTop: a.h + 4, transform: centre(), touchAction: "none" }}>
        <div className="grid grid-cols-6 px-2">
          {[...TABS.map((t) => ({ key: t.id, label: t.label, short: t.short, d: t.d, on: t.id === tab, act: () => onTab(t.id) })),
            { key: "settings", label: "Settings", short: "Settings", d: SETTINGS_ICON, on: false, act: onSettings }].map((t) => (
            <button key={t.key} type="button" data-ctl aria-label={t.label} aria-current={t.on ? "page" : undefined} onClick={() => pick(t.act)}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] ${t.on ? "text-accent font-semibold" : "text-white/75"}`}>
              <Icon d={t.d} />{t.short}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 px-4 pt-1">
          {shown && (
            <button type="button" data-ctl onClick={hideOrSummon} className="h-9 shrink-0 rounded-full bg-white/15 px-3 text-xs font-medium">
              {hidden ? "Summon Miyabi" : "Hide Miyabi"}
            </button>
          )}
          <label data-ctl className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-white/75">
            Mischief
            <input type="range" min={0} max={10} step={1} value={mischief} onChange={(e) => saveMischief(Number(e.target.value))}
              className="accent-accent h-8 min-w-0 flex-1" />
          </label>
        </div>
      </div>

      {/* Hot zone: the toggle (data-island: Miyabi's avoid list needs a non-empty rect; the nav is h-0). Taps arrive as clicks; drags/swipes/long-press are read from the pointer events above. */}
      <button ref={toggle} type="button" data-island aria-label={`Navigation, current: ${label}`} aria-expanded={state === "expanded"} onClick={() => go("tap")}
        className="pointer-events-auto absolute left-1/2 text-white outline-offset-2" style={{ top: hot.top, width: hot.w, height: hot.h, transform: centre(hot.x), touchAction: "none", WebkitTouchCallout: "none" } as React.CSSProperties}>
        {!island && state === "minimal" && (
          <span className="pointer-events-none absolute inset-x-0 text-[11px] font-medium text-white/80" style={{ top: a.top - hot.top, lineHeight: `${a.h}px` }}>{label}</span>
        )}
        {island && state === "minimal" && <span className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-white/25" />}
        {compact && <span className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2"
          style={{ top: a.top + a.h - hot.top, height: rest.h - a.h, width: rest.w, paddingInline: 14 }}>
          <Icon d={TABS.find((t) => t.id === tab)?.d ?? ""} className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left text-xs font-medium">{label}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {mood ? <img src={mood} alt="" draggable={false} className="size-6 shrink-0 rounded-full object-cover object-top" />
            : <span className="size-2 shrink-0 rounded-full bg-white/40" />}
        </span>}
      </button>
    </nav>
  );
}
