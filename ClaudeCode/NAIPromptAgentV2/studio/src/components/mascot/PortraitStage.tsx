"use client";
import { useEffect, useState } from "react";
import type { Expression } from "@/lib/mascot/core";
import type { Profile } from "@/lib/mascot/profiles";
import { portraitPick, talkFrame, TALK_TICK_MS, THINK_TICK_MS, type TalkFrame, type TalkPhase } from "@/lib/mascot/talk";
import { requestJson } from "@/lib/net";

const MOTION: TalkFrame[] = ["think1", "think2", "talk_open", "talk_closed", "listen", "smug"];

/** Waist-up talk portrait. One interval drives the frames (talk/think only); empty = fixed smug, dimmed; reduced motion = expression only. */
export function PortraitStage({ profile, outfit, phase, expression, empty, className = "", style }: {
  profile: Profile; outfit: string; phase: TalkPhase; expression: Expression; empty: boolean; className?: string; style?: React.CSSProperties;
}) {
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [reduced, setReduced] = useState(false);
  const q = profile === "aru" ? "&profile=aru" : "";

  useEffect(() => {
    let live = true;
    const load = () => { requestJson<{ sprites: Record<string, number> }>(`/api/mascot/sprites${q.replace("&", "?")}`).then((r) => live && r.ok && setSprites(r.data.sprites)); };
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
  const ms = reduced ? 0 : p === "talk" ? TALK_TICK_MS : p === "think" ? THINK_TICK_MS : 0;
  useEffect(() => {
    if (!ms) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, p]);

  const have = new Set(Object.keys(sprites));
  const src = (key: string) => `/api/mascot/sprites/${key}?v=${sprites[key]}${q}`;
  // Preload the motion frames for this outfit so the loop never flickers.
  useEffect(() => {
    const h = new Set(Object.keys(sprites));
    for (const f of MOTION) { const k = portraitPick(h, outfit, f).key; if (k) new Image().src = `/api/mascot/sprites/${k}?v=${sprites[k]}${q}`; }
  }, [sprites, outfit, q]);

  const frame = reduced && (p === "think" || p === "talk") ? expression : talkFrame(p, tick, expression);
  const { key, bob } = portraitPick(have, outfit, frame);
  const name = profile === "aru" ? "Aru" : "Miyabi";

  return (
    <div style={style} className={`flex items-end justify-center transition-[filter,opacity,height] duration-300 ${empty ? "opacity-70 grayscale" : ""} ${className}`}>
      {key
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src(key)} alt={`${name}${empty ? " (empty)" : ""}`} draggable={false} className={`h-full w-auto max-w-full object-contain drop-shadow-lg ${bob && !empty ? "mascot-bob" : ""}`} />
        : <span role="img" aria-label={name} className="bg-accent-soft text-accent-ink border-border mascot-bob flex aspect-[3/4] h-4/5 items-center justify-center rounded-t-full border text-4xl font-semibold">{name[0]}</span>}
    </div>
  );
}
