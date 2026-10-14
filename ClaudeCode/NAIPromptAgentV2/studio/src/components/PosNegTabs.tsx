"use client";
import { splitTags } from "@/lib/prompt";

export type Side = "pos" | "neg";
export const tagCount = (s: string) => splitTags(s).length;

/** Positive | Negative switch for a prompt card, with tag counts — one field visible at a time. */
export function PosNegTabs({ side, onSide, pos, neg }: { side: Side; onSide: (s: Side) => void; pos: number; neg: number }) {
  const tab = (s: Side, label: string, n: number) => (
    <button type="button" role="tab" aria-selected={side === s} onClick={() => onSide(s)}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${side === s ? (s === "neg" ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent-ink") : "text-muted"}`}>
      {label}<span className="font-mono text-[10px] opacity-80">{n}</span>
    </button>
  );
  return <div role="tablist" className="bg-bg border-border flex rounded-lg border p-0.5">{tab("pos", "Positive", pos)}{tab("neg", "Negative", neg)}</div>;
}
