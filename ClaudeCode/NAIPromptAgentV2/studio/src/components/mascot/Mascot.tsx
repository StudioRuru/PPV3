"use client";
import { useEffect, useRef, useState } from "react";
import { emitMascot } from "@/lib/mascot/bus";
import { cannedLine, outfitFromSettings, pickSprite, readMs, shouldSpeak, type Expression, type MascotEvent, type Outfit } from "@/lib/mascot/core";
import { stageSprite } from "@/lib/mascot/poses";
import { DATA_RECEIVED } from "@/lib/mascot/slime";
import { composerBottom, nearestCorner, type Corner } from "@/lib/mascot/ui";
import { requestJson } from "@/lib/net";
import { TABS, type Tab } from "@/lib/tabs";
import { isTyping, Stage } from "./Stage";
import { TabCarousel, type Bubble } from "./TabCarousel";

type Settings = { show: boolean; cooldownMs: number | null; nightFrom: number; nightTo: number; pin: Outfit | null; sliders: { flirt: { value: number; live?: number } }; corner: Corner; size: "s" | "m" | "l"; mischief?: number; activity?: boolean };
type Say = { expression: Expression; text: string };

const HUSH_MS = 30 * 60_000, IDLE_MS = 10 * 60_000, LONG_MS = 500, HIDE_MS = 10 * 60_000;
const SIZE_PX = { s: 112, m: 160, l: 208 }; // sprite height; lg screens get 1.25x
const TOP = "calc(env(safe-area-inset-top) + 4rem)";
const PINS = [null, "day", "night", "lewd"] as const;
const SULK: Say[] = [{ expression: "pout", text: "Fine! I'll go sulk somewhere else. Ten minutes. Maybe." }, { expression: "annoyed", text: "Wow. Rude. Don't come crying when you miss me." }];
const post = (body: unknown) => requestJson<{ settings: Settings }>("/api/mascot/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Miyabi: quips about `mascot` bus events on every tab. Full-body on the Stage when the outfit has pose sprites, else the corner bust.
 *  away: she's sitting in the Chat tab's portrait — the roaming Stage/bust hides and quips wait.
 *  Window events: `mascot:hide` {ms?} / `mascot:summon` in; `mascot:hidden` {hidden, show, activity} and `mascot:mood` {src, expression} out (on change and on mount). */
export function Mascot({ rating, prompt, away = false, spy = false, onTap = () => emitMascot("tap"), onTab, onSettings }: {
  rating: string; prompt: string; away?: boolean; spy?: boolean; onTap?: (outfit: Outfit) => void; onTab?: (t: Tab) => void; onSettings?: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [say, setSay] = useState<Say | null>(null);
  const [hushUntil, setHushUntil] = useState(0);
  const [hiddenUntil, setHiddenUntil] = useState(0); // swiped off / Hide: gone until then (summon clears)
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [empty, setEmpty] = useState(false); // no slime inserted: dim + desaturate
  const [bottomAt, setBottomAt] = useState(() => composerBottom([]));
  const live = useRef({ inFlight: false, lastSpokeAt: 0 });
  const press = useRef<{ x: number; y: number; t: number; moved: boolean; long: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const self = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Settings sheet / sprite studio push changes here; "mascot:hush" = Hush now.
    const onSettings = (e: Event) => setSettings((e as CustomEvent<Settings>).detail);
    const onSprites = (e: Event) => setSprites((e as CustomEvent<Record<string, number>>).detail);
    const onHush = () => { setHushUntil(Date.now() + HUSH_MS); setSay(null); };
    const onHide = (e: Event) => { const ms = (e as CustomEvent<{ ms?: number } | null>).detail?.ms; setHiddenUntil(Date.now() + (typeof ms === "number" && ms > 0 ? ms : HIDE_MS)); setMenu(false); setSay(null); };
    const onSummon = () => setHiddenUntil(0);
    const onIdentity = () => {
      requestJson<{ settings: Settings }>("/api/mascot/state").then((r) => r.ok && setSettings(r.data.settings)); // the new slime's sliders (flirt → outfit)
      requestJson<{ empty: boolean }>("/api/mascot/slimes").then((r) => r.ok && setEmpty(r.data.empty));
      requestJson<{ sprites: Record<string, number> }>("/api/mascot/sprites").then((r) => r.ok && setSprites(r.data.sprites)); // an inserted jar may bring its own look
    };
    onIdentity();
    window.addEventListener("mascot:identity", onIdentity);
    window.addEventListener("mascot:settings", onSettings);
    window.addEventListener("mascot:sprites", onSprites);
    window.addEventListener("mascot:hush", onHush);
    window.addEventListener("mascot:hide", onHide);
    window.addEventListener("mascot:summon", onSummon);
    return () => {
      window.removeEventListener("mascot:settings", onSettings); window.removeEventListener("mascot:sprites", onSprites); window.removeEventListener("mascot:hush", onHush); window.removeEventListener("mascot:identity", onIdentity);
      window.removeEventListener("mascot:hide", onHide); window.removeEventListener("mascot:summon", onSummon);
    };
  }, []);

  // Latest values for the window listener without re-subscribing every render.
  const handle = useRef<(e: MascotEvent) => void>(() => {});
  handle.current = async (e) => {
    if (!settings?.show || away || hiddenUntil > Date.now()) return;
    const L = live.current;
    if (!shouldSpeak(e, { now: Date.now(), hushUntil, typing: isTyping(), lastSpokeAt: L.lastSpokeAt, cooldownMs: settings.cooldownMs ?? Infinity, inFlight: L.inFlight })) return;
    L.inFlight = true;
    let r;
    try {
      r = await requestJson<Say>("/api/mascot/quip", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: e, context: { promptSummary: prompt, nsfw: rating === "nsfw" } }) });
    } finally { L.inFlight = false; }
    if (!r.ok || !r.data.text || isTyping()) return; // never show errors in the bubble
    L.lastSpokeAt = Date.now();
    setSay({ expression: r.data.expression, text: r.data.text });
  };
  // "mascot:say" = show this line now (shelf insert/remove): skips the speak gate, but never while typing.
  const sayNow = useRef<(s: Say) => void>(() => {});
  sayNow.current = (s) => {
    if (!settings?.show || away || !s?.text || isTyping() || hiddenUntil > Date.now()) return;
    live.current.lastSpokeAt = Date.now();
    setMenu(false);
    setSay({ expression: s.expression, text: s.text });
  };
  useEffect(() => {
    const on = (e: Event) => handle.current((e as CustomEvent<MascotEvent>).detail);
    const onSay = (e: Event) => sayNow.current((e as CustomEvent<Say>).detail);
    window.addEventListener("mascot", on);
    window.addEventListener("mascot:say", onSay);
    return () => { window.removeEventListener("mascot", on); window.removeEventListener("mascot:say", onSay); };
  }, []);

  // Greet once per app open, as soon as settings are in.
  const greeted = useRef(false);
  useEffect(() => {
    if (!settings || greeted.current) return;
    greeted.current = true;
    let sinceLast: number | null = null;
    try {
      const last = Number(localStorage.getItem("mascot.seen"));
      if (last) sinceLast = Math.round((Date.now() - last) / 60_000);
      localStorage.setItem("mascot.seen", String(Date.now()));
    } catch {}
    emitMascot("greet", { hour: new Date().getHours(), sinceLast });
  }, [settings]);

  // Idle: one nudge per 10-minute stretch without input.
  useEffect(() => {
    let last = Date.now(), fired = false;
    const input = () => { last = Date.now(); fired = false; };
    const tick = setInterval(() => {
      if (fired || Date.now() - last < IDLE_MS) return;
      fired = true;
      emitMascot("idle", { minutes: Math.round((Date.now() - last) / 60_000) });
    }, 60_000);
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    return () => { clearInterval(tick); window.removeEventListener("pointerdown", input); window.removeEventListener("keydown", input); };
  }, []);

  // Bottom corners sit above whichever [data-composer] bar is showing: clearance from the viewport bottom (hidden ones measure 0).
  useEffect(() => {
    const seen = new Set<Element>();
    const measure = () => setBottomAt(composerBottom([...document.querySelectorAll<HTMLElement>("[data-composer]")].map((el) => el.offsetHeight > 0 ? window.innerHeight - el.getBoundingClientRect().top : 0)));
    const ro = new ResizeObserver(measure);
    window.addEventListener("resize", measure); // a viewport resize moves fixed bars without resizing them
    let raf = 0;
    const scan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.querySelectorAll("[data-composer]").forEach((el) => { if (!seen.has(el)) { seen.add(el); ro.observe(el); } });
        measure();
      });
    };
    const mo = new MutationObserver(scan); // composers mount/unmount (RP chat, sheets)
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { cancelAnimationFrame(raf); mo.disconnect(); ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // Text field focused = typing: she moves out of the way and stays quiet.
  useEffect(() => {
    const check = () => setTimeout(() => { const t = isTyping(); setTyping(t); if (t) { setSay(null); setMenu(false); } }, 0); // a bubble/menu must never sit over the field
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", check); };
  }, []);

  useEffect(() => {
    if (!say) return;
    const t = setTimeout(() => setSay(null), readMs(say.text));
    return () => clearTimeout(t);
  }, [say]);
  const hushed = hushUntil > Date.now();
  useEffect(() => {
    if (!hushed) return;
    const t = setTimeout(() => setHushUntil(0), hushUntil - Date.now());
    return () => clearTimeout(t);
  }, [hushed, hushUntil]);

  const hidden = hiddenUntil > Date.now();
  useEffect(() => {
    if (!hidden) return;
    const t = setTimeout(() => setHiddenUntil(0), hiddenUntil - Date.now());
    return () => clearTimeout(t);
  }, [hidden, hiddenUntil]);
  // Tell the island / Settings (deferred so listeners mounting in the same commit hear the first one).
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent("mascot:hidden", { detail: { hidden, show: !!settings?.show, activity: settings?.activity !== false } })), 0);
    return () => clearTimeout(t);
  }, [hidden, settings?.show, settings?.activity]);

  const outfit: Outfit = settings ? outfitFromSettings(settings, rating === "nsfw") : "day";
  const sprite = pickSprite(new Set(Object.keys(sprites)), outfit, say?.expression ?? (hushed ? "sleepy" : "smug"));
  // Tell the island which bust to show (null = hidden / no sprite), deferred like mascot:hidden.
  const mood = settings?.show && !hidden && sprite ? `/api/mascot/sprites/${sprite}?v=${sprites[sprite]}` : null;
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent("mascot:mood", { detail: { src: mood, expression: sprite?.split("/")[1] } })), 0);
    return () => clearTimeout(t);
  }, [mood]);

  if (!settings?.show) return null;

  const corner = settings.corner, bottom = corner[0] === "b", right = corner[1] === "r";

  function hush() { setHushUntil(Date.now() + HUSH_MS); setSay(null); setMenu(false); }
  const have = new Set(Object.keys(sprites));
  async function save(patch: Partial<Settings>) {
    setSettings({ ...settings!, ...patch });
    const r = await post({ settings: patch });
    if (r.ok) setSettings(r.data.settings);
  }

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, long: false } as NonNullable<typeof press.current>;
    p.timer = setTimeout(() => { p.long = true; setMenu(true); setSay(null); }, LONG_MS);
    press.current = p;
  }
  function move(e: React.PointerEvent) {
    const p = press.current;
    if (!p || p.long) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 8) return;
    p.moved = true; clearTimeout(p.timer);
    setDrag({ dx, dy });
  }
  function up(e: React.PointerEvent) {
    const p = press.current; press.current = null;
    if (!p) return;
    clearTimeout(p.timer); setDrag(null);
    if (p.long) return;
    if (!p.moved) { setMenu(false); onTap(outfit); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (dy > 50 && Math.abs(dx) < dy / 2 && e.timeStamp - p.t < 400) { hush(); return; } // quick flick down
    const r = self.current!.getBoundingClientRect(); // still at the dragged spot (setDrag(null) hasn't rendered)
    const next = nearestCorner(r.left + r.width / 2, r.top + r.height / 2, window.innerWidth, window.innerHeight);
    if (next !== corner) save({ corner: next });
  }

  if (stageSprite(have, "stand", outfit, "smug")) {
    const close = () => setMenu(false), go = (f: () => void) => () => { close(); f(); };
    const bubbles: Bubble[] = [
      { label: "Talk", onSelect: go(() => onTap(outfit)) },
      ...(onTab ? TABS.map(({ id, label }) => ({ label, onSelect: go(() => onTab(id)) })) : []),
      ...(onSettings ? [{ label: "Settings", onSelect: go(onSettings) }] : []),
      { label: hushed ? "Wake up" : "Hush 30 min", small: true, onSelect: hushed ? go(() => setHushUntil(0)) : hush },
      { label: `Outfit: ${settings.pin ?? "auto"}`, small: true, onSelect: () => save({ pin: PINS[(PINS.indexOf(settings.pin) + 1) % PINS.length] }) },
      { label: "Hide 10 min", small: true, onSelect: go(() => setHiddenUntil(Date.now() + HIDE_MS)) },
    ];
    return (
      <Stage sprites={sprites} outfit={outfit} expression={say?.expression ?? (hushed ? "sleepy" : null)} size={settings.size ?? "m"} mischief={settings.mischief ?? 5}
        empty={empty} hushed={hushed} typing={typing} hidden={hidden || away} spy={spy} layout={bottomAt} menuOpen={menu && !hidden && !away}
        label={`Miyabi${empty ? " (empty)" : ""}${hushed ? " (hushed)" : ""} — tap for the menu, drag to move, flick to throw`}
        onMenu={() => { setMenu(true); setSay(null); }} onCloseMenu={close}
        onPoke={() => { if (!hushed && Math.random() < 0.4) sayNow.current(empty ? { expression: "smug", text: DATA_RECEIVED } : cannedLine("tap")); }}
        onSwipeOff={() => { setMenu(false); const s: Say = empty ? { expression: "smug", text: DATA_RECEIVED } : SULK[Math.floor(Math.random() * SULK.length)]; if (!isTyping()) { live.current.lastSpokeAt = Date.now(); setSay(s); } setHiddenUntil(Date.now() + HIDE_MS); }}
        overlay={away ? null : menu && !hidden ? <TabCarousel items={bubbles} onClose={close} />
          : say && <button type="button" onClick={() => setSay(null)} className="bg-surface border-border animate-rise block w-max max-w-full rounded-2xl border px-3 py-2 text-left text-sm shadow-lg">{say.text}</button>} />
    );
  }
  if (hidden || away) return null;

  // While typing in a bottom corner she slides up to the top one, out of the keyboard/composer's way.
  const lift = typing && bottom ? `translateY(calc(${TOP} + ${bottomAt} + 100% - 100dvh))` : "";
  const pop = `absolute ${bottom ? "bottom-full mb-1" : "top-full mt-1"} ${right ? "right-0" : "left-0"}`;

  return (
    <div ref={self} data-noswipe className={`fixed z-[35] select-none ${typing ? "pointer-events-none opacity-50" : ""} ${drag ? "" : "transition-transform duration-300"}`}
      style={{ [bottom ? "bottom" : "top"]: bottom ? bottomAt : TOP, [right ? "right" : "left"]: "0.75rem",
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : lift || undefined }}>
      <div aria-live="polite" className={pop}>
        {say && !menu && (
          <button type="button" onClick={() => setSay(null)}
            className="bg-surface border-border animate-rise block w-max max-w-[16rem] rounded-2xl border px-3 py-2 text-left text-sm shadow-lg">
            {say.text}
          </button>
        )}
      </div>
      {menu && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 -z-10 cursor-default" onClick={() => setMenu(false)} />
          <div role="menu" aria-label="Miyabi" className={`${pop} bg-surface border-border w-44 rounded-xl border p-1 text-sm shadow-lg`}
            onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
            <button type="button" role="menuitem" autoFocus onClick={() => (hushed ? (setHushUntil(0), setMenu(false)) : hush())}
              className="w-full rounded-lg px-3 py-2 text-left">{hushed ? "Wake up" : "Hush 30 min"}</button>
            <p className="text-faint px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide">Outfit</p>
            {([null, "day", "night", "lewd"] as const).map((o) => (
              <button key={o ?? "auto"} type="button" role="menuitemradio" aria-checked={settings.pin === o}
                onClick={() => { save({ pin: o }); setMenu(false); }}
                className={`w-full rounded-lg px-3 py-2 text-left capitalize ${settings.pin === o ? "text-accent font-semibold" : ""}`}>{o ?? "auto"}</button>
            ))}
          </div>
        </>
      )}
      <div role="button" tabIndex={0} aria-label={`Miyabi${empty ? " (empty)" : ""}${hushed ? " (hushed)" : ""} — tap to talk, hold for options, drag to move`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { clearTimeout(press.current?.timer); press.current = null; setDrag(null); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(outfit); } else if (e.key === "ContextMenu") setMenu(true); }}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); setSay(null); }}
        className={`relative cursor-grab transition-[filter,opacity] duration-500 ${empty ? "opacity-70 grayscale" : ""}`} style={{ touchAction: "none", WebkitTouchCallout: "none", "--mascot-h": `${SIZE_PX[settings.size ?? "m"]}px` } as React.CSSProperties}>
        {sprite
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/api/mascot/sprites/${sprite}?v=${sprites[sprite]}`} alt="" draggable={false} className="mascot-bob h-[var(--mascot-h)] lg:h-[calc(var(--mascot-h)*1.25)] w-auto drop-shadow-lg" />
          : <span className="mascot-bob h-[var(--mascot-h)] lg:h-[calc(var(--mascot-h)*1.25)] bg-accent-soft text-accent-ink border-border flex aspect-square items-center justify-center rounded-full border text-2xl font-semibold">M</span>}
        {hushed && <span aria-hidden="true" className="text-muted absolute -top-1 font-mono text-xs" style={{ [right ? "left" : "right"]: 0 }}>zzz</span>}
      </div>
    </div>
  );
}
