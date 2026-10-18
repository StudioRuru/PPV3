"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { LEGACY, type Expression } from "@/lib/mascot/core";
import { clipsFor, clipUrl, clipUrls, reactionFor, type Clips, type ReactEvent } from "@/lib/mascot/play";
import type { Profile } from "@/lib/mascot/profiles";
import { blinkSchedule } from "@/lib/mascot/stage";
import { portraitPick, talkFrame, TALK_TICK_MS, THINK_TICK_MS, type TalkFrame, type TalkPhase } from "@/lib/mascot/talk";
import { requestJson } from "@/lib/net";
import { useLibrary } from "@/lib/sprites/useLibrary";
import { ClipPortrait } from "./ClipPortrait";
import { SpriteCanvas, useClip } from "./SpriteCanvas";

const MOTION: TalkFrame[] = ["think1", "think2", "talk_open", "talk_closed", "listen", "smug"];

/** Waist-up talk portrait. An outfit with a Sprites-studio chat idle for the current expression plays animated clips (ClipPortrait, kept mounted);
 *  talk/think/listen frames are stills drawn over it. Other outfits keep the SpriteCanvas path: blink and reaction clips over the still,
 *  one interval alternating talk_open/talk_closed (think too), empty = fixed smug, dimmed, breathing only; reduced motion = expression only (spec §13.1). */
export function PortraitStage({ profile, outfit, phase, expression, empty, className = "", style }: {
  profile: Profile; outfit: string; phase: TalkPhase; expression: Expression; empty: boolean; className?: string; style?: React.CSSProperties;
}) {
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [clipList, setClipList] = useState<Clips | null>(null);
  const [tick, setTick] = useState(0);
  const [reduced, setReduced] = useState(false);
  const q = profile === "aru" ? "&profile=aru" : "";

  useEffect(() => {
    let live = true;
    const load = () => { requestJson<{ sprites: Record<string, number> } & Clips>(`/api/mascot/sprites${q.replace("&", "?")}`).then((r) => { if (live && r.ok) { setSprites(r.data.sprites); setClipList(r.data); } }); };
    load();
    window.addEventListener("mascot:sprites", load); // studio picks
    window.addEventListener("mascot:identity", load); // a new slime may bring its own look
    return () => { live = false; window.removeEventListener("mascot:sprites", load); window.removeEventListener("mascot:identity", load); };
  }, [q]);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const p: TalkPhase = empty ? "empty" : phase;
  const have = new Set(Object.keys(sprites));
  const still = portraitPick(have, outfit, p === "empty" ? "smug" : expression).key; // the expression still: clips hang off it
  const clips = useMemo(() => clipsFor(clipList, still), [clipList, still]);
  const clip = useClip(empty);
  const clipTalk = p === "talk" && !reduced && !!clips.talk;
  useEffect(() => { if (clipTalk) clip.play("talk", still, clips); else clip.stop("talk"); }, [clipTalk, still, clips, clip]);
  const ms = reduced ? 0 : p === "talk" && !clipTalk ? TALK_TICK_MS : p === "think" ? THINK_TICK_MS : 0;
  useEffect(() => {
    if (!ms) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, p]);

  const src = (key: string) => `/api/mascot/sprites/${key}?v=${sprites[key]}${q}`;
  // Preload the motion frames for this outfit so the loop never flickers.
  useEffect(() => {
    const h = new Set(Object.keys(sprites));
    for (const f of MOTION) { const k = portraitPick(h, outfit, f).key; if (k) new Image().src = `/api/mascot/sprites/${k}?v=${sprites[k]}${q}`; }
  }, [sprites, outfit, q]);

  const frame = clipTalk || (reduced && (p === "think" || p === "talk")) ? expression : talkFrame(p, tick, expression);
  const { key, bob } = portraitPick(have, outfit, frame);
  const name = profile === "aru" ? "Aru" : "Miyabi";
  const atStill = !!key && key === still; // blink/reactions only over the still (not think/listen/talk frames)

  // Blink + reactions read the latest still through a ref (long-lived timers/listeners).
  const now = useRef({ still, clips, atStill, expression });
  now.current = { still, clips, atStill, expression };
  useEffect(() => {
    if (empty || !clips.blink) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(() => { const n = now.current; if (n.atStill) clip.play("blink", n.still, n.clips); loop(); }, blinkSchedule(Math.random)); };
    loop();
    return () => clearTimeout(t);
  }, [empty, !!clips.blink, clip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const react = (ev: ReactEvent) => {
      const n = now.current, k = reactionFor(ev, n.expression, Math.random);
      if (n.atStill && n.clips[k] && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) clip.play(k, n.still, n.clips);
    };
    const onReact = (e: Event) => { const d = (e as CustomEvent<{ profile: Profile; event: ReactEvent }>).detail; if (d?.profile === profile) react(d.event); };
    const onBus = (e: Event) => { const k = (e as CustomEvent<{ kind: string }>).detail?.kind; if (profile === "miyabi" && (k === "generated" || k === "upscaled")) react(k); };
    window.addEventListener("mascot:react", onReact);
    window.addEventListener("mascot", onBus);
    return () => { window.removeEventListener("mascot:react", onReact); window.removeEventListener("mascot", onBus); };
  }, [profile, clip]);
  // The still's clip frames into the HTTP cache so swaps don't wait on the network.
  useEffect(() => { for (const u of clipUrls(clipList, still, profile === "aru")) new Image().src = u; }, [clipList, still, profile]);
  const lib = useLibrary();
  const ck = p === "empty" ? "smug" : LEGACY[expression] ?? expression;
  const animated = !!lib && lib.clips.some((c) => c.surface === "chat" && c.outfit === outfit && c.from === ck && c.to === ck);
  const playing = clip.show();
  const shown = key && ((playing && clipUrl(clipList, playing.key, playing.kind, playing.frame, profile === "aru")) || src(key));

  return (
    <div style={style} className={`relative flex items-end justify-center transition-[filter,opacity,height] duration-300 ${empty ? `opacity-70 ${shown ? "" : "grayscale"}` : ""} ${className}`}>
      {animated && <ClipPortrait key={outfit} lib={lib} outfit={outfit} expression={ck} className="h-full w-full" />}
      {animated
        ? frame !== expression && key && <SpriteCanvas src={src(key)} empty={empty} alt={`${name}${empty ? " (empty)" : ""}`} className={`absolute inset-x-0 bottom-0 h-full w-full ${bob && !empty ? "mascot-bob" : ""}`} />
        : shown
        ? <SpriteCanvas src={shown} cut={playing?.kind === "blink"} empty={empty} alt={`${name}${empty ? " (empty)" : ""}`} className={`h-full w-full ${bob && !empty ? "mascot-bob" : ""}`} />
        : <span role="img" aria-label={name} className="bg-accent-soft text-accent-ink border-border mascot-bob flex aspect-[3/4] h-4/5 items-center justify-center rounded-t-full border text-4xl font-semibold">{name[0]}</span>}
    </div>
  );
}
