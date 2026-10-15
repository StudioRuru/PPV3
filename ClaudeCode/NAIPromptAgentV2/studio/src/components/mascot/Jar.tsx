"use client";
import { useId } from "react";

const BODY = "M18 18 h28 v6 q12 4 12 18 v26 q0 8 -8 8 h-36 q-8 0 -8 -8 v-26 q0 -14 12 -18 z";

/** A glass jar of slime tinted `color`; `color` null = an empty dashed slot. Active = wobbling liquid + glow ring. */
export function Jar({ color, active = false }: { color: string | null; active?: boolean }) {
  const clip = useId();
  if (!color) return (
    <svg viewBox="0 0 64 80" aria-hidden="true" className="h-20 w-16">
      <path d={BODY} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-faint" />
      <rect x="16" y="9" width="32" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-faint" />
    </svg>
  );
  return (
    <svg viewBox="0 0 64 80" aria-hidden="true" className="h-20 w-16 overflow-visible"
      style={active ? { filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 2px ${color})` } : undefined}>
      <defs><clipPath id={clip}><path d={BODY} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <g className={active ? "jar-wobble" : undefined}>
          <path d="M-4 40 q12 -5 24 0 t24 0 t24 0 v44 h-72 z" fill={color} opacity="0.85" />
          <path d="M-4 40 q12 -5 24 0 t24 0 t24 0" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" />
        </g>
        <ellipse cx="17" cy="50" rx="3" ry="11" fill="white" opacity="0.28" />
      </g>
      <path d={BODY} fill="white" fillOpacity="0.06" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" className="text-fg" />
      <rect x="16" y="8" width="32" height="11" rx="2.5" fill="#a0764e" stroke="#6b4a2d" strokeWidth="1" />
      <path d="M20 12 h24 M20 15.5 h24" stroke="#6b4a2d" strokeOpacity="0.5" strokeWidth="0.8" />
    </svg>
  );
}
