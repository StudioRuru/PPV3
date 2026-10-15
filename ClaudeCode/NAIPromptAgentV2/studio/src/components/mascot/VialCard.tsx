"use client";
import { useId } from "react";
import type { Vial } from "@/lib/mascot/vial";
import { deltaChips } from "@/lib/mascot/ui";

const BODY = "M13 4 h10 v9 q9 4 9 14 v13 q0 4 -4 4 h-20 q-4 0 -4 -4 v-13 q0 -10 9 -14 z";

/** A small round-bottomed potion bottle filled with `color`. */
export function Bottle({ color, className = "h-12 w-9" }: { color: string; className?: string }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 36 48" aria-hidden="true" className={`shrink-0 ${className}`}>
      <defs><clipPath id={clip}><path d={BODY} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <path d="M0 24 q9 -3 18 0 t18 0 v24 h-36 z" fill={color} opacity="0.9" />
        <ellipse cx="11" cy="31" rx="1.8" ry="6" fill="white" opacity="0.3" />
      </g>
      <path d={BODY} fill="white" fillOpacity="0.06" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" className="text-fg" />
      <rect x="12" y="1" width="12" height="5" rx="1.5" fill="#a0764e" stroke="#6b4a2d" strokeWidth="0.8" />
    </svg>
  );
}

/** A vial: tinted bottle, name, effect, slider delta chips; `children` = actions (Bottle it, Brew again…). */
export function VialCard({ vial, badge, children }: { vial: Vial; badge?: string; children?: React.ReactNode }) {
  const chips = deltaChips(vial.sliders);
  return (
    <div className="border-border bg-surface-2 flex gap-3 rounded-lg border p-2.5">
      <Bottle color={vial.color} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-baseline gap-2 text-sm font-semibold"><span className="truncate">{vial.name}</span>{badge && <span className="text-muted shrink-0 text-xs font-normal">{badge}</span>}</p>
        <p className="text-muted text-xs break-words">{vial.effect}</p>
        {chips.length > 0 && (
          <ul aria-label="Slider changes" className="flex flex-wrap gap-1">
            {chips.map((c) => <li key={c} className="bg-accent-soft text-accent-ink rounded-full px-2 py-0.5 font-mono text-[11px]">{c}</li>)}
          </ul>
        )}
        {children}
      </div>
    </div>
  );
}
